import {
  configureStyleProfiles,
  getPennyMode,
  listPennyModes,
  listStyleProfiles,
  resolveStyleProfile,
} from "../../../server/domain.mjs";

export const pennyModes = listPennyModes().map((mode) => ({
  id: mode.id,
  label: mode.shortLabel,
  description: mode.description,
  profile: mode.profile,
}));

export let styleProfiles = listStyleProfiles();

export function configurePennyProfiles(profiles, defaultProfileId) {
  configureStyleProfiles(profiles, defaultProfileId);
  styleProfiles = listStyleProfiles();
  return styleProfiles;
}

export function modeById(modeId) {
  try {
    const mode = getPennyMode(modeId);
    return {
      id: mode.id,
      label: mode.shortLabel,
      description: mode.description,
      profile: mode.profile,
    };
  } catch {
    return pennyModes[0];
  }
}

export function styleProfileById(styleProfileId) {
  const resolved = resolveStyleProfile(styleProfileId);
  if (resolved.available) return { ...resolved.profile, available: true };
  return {
    ...resolved.profile,
    id: resolved.requestedId,
    label: `${resolved.requestedId} (unavailable)`,
    description: "This saved profile is not loaded. Choose another profile to replace it.",
    available: false,
  };
}
