import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "penny-tailscale.sh"
PENNY_SERVER = REPO / "scripts" / "penny-server.sh"
PENNY_CONFIG = '{"version":"0.0.1","TCP":{"443":{"HTTPS":true,"Handlers":{"/":{"Proxy":"http://127.0.0.1:4177"}}}}}'
EMPTY_CONFIG = '{"version":"0.0.1"}'


def run_script(*args, **env):
    process_env = os.environ.copy()
    process_env.update(env)
    return subprocess.run(
        [str(SCRIPT), *args],
        cwd=REPO,
        env=process_env,
        text=True,
        capture_output=True,
        check=False,
    )


class PennyTailscaleScriptTests(unittest.TestCase):
    def test_script_exists_and_lists_expected_commands(self):
        self.assertTrue(SCRIPT.exists())
        result = run_script()

        self.assertEqual(result.returncode, 2)
        self.assertIn("on|off|restart|status|smoke|url", result.stdout)

    def test_dry_run_on_configures_private_tailscale_serve_without_funnel(self):
        result = run_script(
            "on",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_HOST="writer-laptop.example-tailnet.ts.net",
            PENNY_TAILSCALE_USERS="writer@example.com",
            PENNY_TAILSCALE_CONFIG_JSON=EMPTY_CONFIG,
            PENNY_TAILSCALE_STATUS_JSON=EMPTY_CONFIG,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("penny_tailscale.status=would_start", result.stdout)
        self.assertIn(
            "PENNY_ALLOWED_HOSTS=writer-laptop.example-tailnet.ts.net PENNY_TAILSCALE_USERS=writer@example.com scripts/penny-server.sh restart",
            result.stdout,
        )
        self.assertIn("tailscale serve --bg --yes --https=443 http://127.0.0.1:4177", result.stdout)
        self.assertNotIn("funnel", result.stdout.lower())

    def test_dry_run_path_mode_configures_path_scoped_serve(self):
        result = run_script(
            "on",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_HOST="writer-server.example-tailnet.ts.net",
            PENNY_TAILSCALE_USERS="writer@example.com",
            PENNY_TAILSCALE_PATH="/penny",
            PENNY_TAILSCALE_CONFIG_JSON=EMPTY_CONFIG,
            PENNY_TAILSCALE_STATUS_JSON='{"Web":{"writer-server.example-tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"},"/reports":{"Proxy":"http://127.0.0.1:8787"}}}}}',
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("penny_tailscale.status=would_start", result.stdout)
        self.assertNotIn("PENNY_BASE_PATH=/penny", result.stdout)
        self.assertIn("PENNY_ALLOWED_HOSTS=writer-server.example-tailnet.ts.net", result.stdout)
        self.assertIn("tailscale serve --bg --yes --https=443 --set-path=/penny http://127.0.0.1:4177", result.stdout)
        self.assertIn("penny_tailscale.url=https://writer-server.example-tailnet.ts.net/penny", result.stdout)

    def test_path_mode_refuses_conflicting_path_but_allows_other_handlers(self):
        result = run_script(
            "on",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_HOST="writer-server.example-tailnet.ts.net",
            PENNY_TAILSCALE_USERS="writer@example.com",
            PENNY_TAILSCALE_PATH="/penny",
            PENNY_TAILSCALE_CONFIG_JSON=EMPTY_CONFIG,
            PENNY_TAILSCALE_STATUS_JSON='{"Web":{"writer-server.example-tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"},"/penny":{"Proxy":"http://127.0.0.1:9999"}}}}}',
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("penny_tailscale.error=serve_config_not_penny_path", result.stderr)

    def test_path_mode_refuses_existing_funnel_state(self):
        result = run_script(
            "on",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_HOST="writer-server.example-tailnet.ts.net",
            PENNY_TAILSCALE_USERS="writer@example.com",
            PENNY_TAILSCALE_PATH="/penny",
            PENNY_TAILSCALE_CONFIG_JSON=EMPTY_CONFIG,
            PENNY_TAILSCALE_STATUS_JSON='{"Web":{"writer-server.example-tailnet.ts.net:443":{"Funnel":true,"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"}}}}}',
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("penny_tailscale.error=serve_config_not_penny_path", result.stderr)

    def test_tailnet_exposure_requires_tailnet_user_allowlist(self):
        result = run_script(
            "on",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_HOST="writer-server.example-tailnet.ts.net",
            PENNY_TAILSCALE_PATH="/penny",
            PENNY_TAILSCALE_CONFIG_JSON=EMPTY_CONFIG,
            PENNY_TAILSCALE_STATUS_JSON='{"BackendState":"Running","Self":{"DNSName":"writer-server.example-tailnet.ts.net","UserID":"1"},"User":{}}',
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("penny_tailscale.error=missing_tailscale_user_allowlist", result.stderr)

    def test_remote_runtime_control_env_is_persisted_when_explicitly_enabled(self):
        result = run_script(
            "on",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_HOST="writer-server.example-tailnet.ts.net",
            PENNY_TAILSCALE_USERS="writer@example.com",
            PENNY_TAILSCALE_PATH="/penny",
            PENNY_TAILSCALE_CONFIG_JSON=EMPTY_CONFIG,
            PENNY_TAILSCALE_STATUS_JSON=EMPTY_CONFIG,
            PENNY_ALLOW_REMOTE_RUNTIME_CONTROL="1",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PENNY_ALLOW_REMOTE_RUNTIME_CONTROL=1", result.stdout)

    def test_path_mode_off_uses_path_specific_disable_without_global_reset(self):
        result = run_script(
            "off",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_PATH="/penny",
            PENNY_TAILSCALE_CONFIG_JSON=EMPTY_CONFIG,
            PENNY_TAILSCALE_STATUS_JSON='{"Web":{"writer-server.example-tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:8787"},"/penny":{"Proxy":"http://127.0.0.1:4177"}}}}}',
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("penny_tailscale.status=would_stop", result.stdout)
        self.assertIn("serve --https=443 --set-path=/penny off", result.stdout)
        self.assertNotIn("serve reset", result.stdout)

    def test_url_reports_tailnet_https_url(self):
        result = run_script(
            "url",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_HOST="writer-laptop.example-tailnet.ts.net",
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("https://writer-laptop.example-tailnet.ts.net", result.stdout)

    def test_url_strips_trailing_dot_from_status_json(self):
        result = run_script(
            "url",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_STATUS_JSON='{"BackendState":"Running","Self":{"DNSName":"writer-laptop.example-tailnet.ts.net."}}',
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("https://writer-laptop.example-tailnet.ts.net", result.stdout)

    def test_dry_run_on_refuses_conflicting_serve_config(self):
        result = run_script(
            "on",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_HOST="writer-laptop.example-tailnet.ts.net",
            PENNY_TAILSCALE_USERS="writer@example.com",
            PENNY_TAILSCALE_CONFIG_JSON='{"version":"0.0.1","TCP":{"443":{"HTTPS":true,"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}}}',
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("penny_tailscale.error=serve_config_not_penny_only", result.stderr)

    def test_dry_run_on_refuses_conflicting_status_when_declared_config_is_empty(self):
        result = run_script(
            "on",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_HOST="writer-laptop.example-tailnet.ts.net",
            PENNY_TAILSCALE_USERS="writer@example.com",
            PENNY_TAILSCALE_CONFIG_JSON=EMPTY_CONFIG,
            PENNY_TAILSCALE_STATUS_JSON='{"Web":{"writer-laptop.example-tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}}}',
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("penny_tailscale.error=serve_config_not_penny_only", result.stderr)

    def test_dry_run_off_stops_penny_owned_config(self):
        result = run_script(
            "off",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_CONFIG_JSON=PENNY_CONFIG,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("penny_tailscale.status=would_stop", result.stdout)
        self.assertIn("serve reset", result.stdout)

    def test_dry_run_off_stops_penny_status_when_declared_config_is_empty(self):
        result = run_script(
            "off",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_DRY_RUN="1",
            PENNY_TAILSCALE_CONFIG_JSON=EMPTY_CONFIG,
            PENNY_TAILSCALE_STATUS_JSON='{"Web":{"writer-laptop.example-tailnet.ts.net:443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:4177"}}}}}',
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("penny_tailscale.status=would_stop", result.stdout)
        self.assertIn("serve reset", result.stdout)

    def test_off_refuses_to_reset_non_penny_serve_config(self):
        result = run_script(
            "off",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_CONFIG_JSON='{"version":"0.0.1","TCP":{"443":{"HTTPS":true,"Handlers":{"/":{"Proxy":"http://127.0.0.1:9999"}}}}}',
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("penny_tailscale.error=serve_config_not_penny_only", result.stderr)

    def test_off_refuses_mixed_penny_and_non_penny_serve_config(self):
        result = run_script(
            "off",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_CONFIG_JSON='{"version":"0.0.1","TCP":{"443":{"HTTPS":true,"Handlers":{"/":{"Proxy":"http://127.0.0.1:4177"},"/other":{"Proxy":"http://127.0.0.1:9999"}}}}}',
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("penny_tailscale.error=serve_config_not_penny_only", result.stderr)

    def test_off_refuses_malformed_serve_config(self):
        result = run_script(
            "off",
            TAILSCALE_BIN="/usr/bin/true",
            PENNY_TAILSCALE_CONFIG_JSON="{not-json",
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn("penny_tailscale.error=serve_config_not_penny_only", result.stderr)

    def test_penny_server_plist_persists_tailnet_env(self):
        process_env = os.environ.copy()
        process_env.update(
            {
                "PENNY_ALLOWED_HOSTS": "writer-laptop.example-tailnet.ts.net",
                "PENNY_TAILSCALE_USERS": "writer@example.com",
                "PENNY_BASE_PATH": "/penny",
                "PENNY_RUNTIME_SCRIPT": "/opt/penny-runtime/scripts/writing-runtime.sh",
                "PENNY_MODEL_BASE_URL": "http://127.0.0.1:8091/v1",
                "PENNY_STATE_DIR": "/var/lib/penny",
                "PENNY_VOICE_PACK_DIR": "/opt/penny/voice-packs",
                "WRITING_RUNTIME_HF_HOME": "/srv/penny-models",
                "WRITING_RUNTIME_SUPERVISOR": "process",
            }
        )
        result = subprocess.run(
            [str(PENNY_SERVER), "plist"],
            cwd=REPO,
            env=process_env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        plist = REPO / "runtime" / "org.penny-writing-workspace.plist"
        contents = plist.read_text()
        self.assertIn("<key>PENNY_BASE_PATH</key>", contents)
        self.assertIn("<string>/penny</string>", contents)
        self.assertIn("<key>PENNY_ALLOWED_HOSTS</key>", contents)
        self.assertIn("<string>writer-laptop.example-tailnet.ts.net</string>", contents)
        self.assertIn("<key>PENNY_TAILSCALE_USERS</key>", contents)
        self.assertIn("<string>writer@example.com</string>", contents)
        self.assertIn("<key>PENNY_RUNTIME_SCRIPT</key>", contents)
        self.assertIn("<string>/opt/penny-runtime/scripts/writing-runtime.sh</string>", contents)
        self.assertIn("<key>PENNY_MODEL_BASE_URL</key>", contents)
        self.assertIn("<string>http://127.0.0.1:8091/v1</string>", contents)
        self.assertIn("<key>PENNY_STATE_DIR</key>", contents)
        self.assertIn("<key>PENNY_VOICE_PACK_DIR</key>", contents)
        self.assertIn("<string>/opt/penny/voice-packs</string>", contents)
        self.assertIn("<string>/var/lib/penny</string>", contents)
        self.assertIn("<key>WRITING_RUNTIME_HF_HOME</key>", contents)
        self.assertIn("<string>/srv/penny-models</string>", contents)
        self.assertIn("<key>WRITING_RUNTIME_SUPERVISOR</key>", contents)
        self.assertIn("<string>process</string>", contents)

        status = subprocess.run(
            [str(PENNY_SERVER), "status"],
            cwd=REPO,
            env={**os.environ.copy(), "PENNY_SERVER_STATUS_SOURCE": "plist"},
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(status.returncode, 0, status.stderr)
        self.assertIn("penny_server.base_path=/penny", status.stdout)
        self.assertIn("penny_server.allowed_hosts=writer-laptop.example-tailnet.ts.net", status.stdout)
        self.assertIn("penny_server.runtime_script=/opt/penny-runtime/scripts/writing-runtime.sh", status.stdout)
        self.assertIn("penny_server.model_base_url=http://127.0.0.1:8091/v1", status.stdout)
        self.assertIn("penny_server.state_dir=/var/lib/penny", status.stdout)
        self.assertIn("penny_server.voice_pack_dir=/opt/penny/voice-packs", status.stdout)

    def test_penny_server_status_reads_loaded_launchd_environment_before_plist(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            fake_launchctl = Path(temp_dir) / "launchctl"
            fake_launchctl.write_text(
                """#!/usr/bin/env bash
if [[ "$1" == "print" ]]; then
  cat <<'OUT'
gui/501/org.penny-writing-workspace = {
  state = running
  environment = {
    PENNY_BASE_PATH => /penny
    PENNY_ALLOWED_HOSTS => writer-server.example-tailnet.ts.net
    PENNY_TAILSCALE_USERS => writer@example.com
  }
}
OUT
  exit 0
fi
exit 0
""",
                encoding="utf-8",
            )
            fake_launchctl.chmod(0o755)
            env = os.environ.copy()
            env["PATH"] = f"{temp_dir}:{env['PATH']}"
            result = subprocess.run(
                [str(PENNY_SERVER), "status"],
                cwd=REPO,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("penny_server.base_path=/penny", result.stdout)
        self.assertIn("penny_server.allowed_hosts=writer-server.example-tailnet.ts.net", result.stdout)
        self.assertIn("penny_server.tailscale_users=writer@example.com", result.stdout)


if __name__ == "__main__":
    unittest.main()
