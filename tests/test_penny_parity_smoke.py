import os
import re
import subprocess
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "penny-parity-smoke.sh"
LIVE_MODEL_SMOKE = REPO / "scripts" / "penny-live-model-smoke.sh"
DOMAIN = REPO / "server" / "domain.mjs"


class PennyParitySmokeTests(unittest.TestCase):
    def test_dry_run_can_include_tailnet_browser_and_live_model_checks(self):
        env = os.environ.copy()
        env.update(
            {
                "PENNY_BASE_URL": "https://writer-server.example-tailnet.ts.net/penny",
                "PENNY_TAILSCALE_PATH": "/penny",
            }
        )
        result = subprocess.run(
            [str(SCRIPT), "--dry-run", "--tailnet", "--live-model"],
            cwd=REPO,
            env=env,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("+ scripts/penny-tailscale.sh smoke", result.stdout)
        self.assertIn("+ npm run browser-smoke", result.stdout)
        self.assertIn("+ scripts/penny-live-model-smoke.sh", result.stdout)
        self.assertIn("penny_parity_smoke.status=would_run", result.stdout)

    def test_live_model_smoke_uses_a_registered_penny_mode(self):
        smoke = LIVE_MODEL_SMOKE.read_text()
        domain = DOMAIN.read_text()
        mode = re.search(r'"modeId": "([^"]+)"', smoke)
        self.assertIsNotNone(mode)
        self.assertIn(f'id: "{mode.group(1)}"', domain)


if __name__ == "__main__":
    unittest.main()
