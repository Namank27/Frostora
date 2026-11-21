// Adapter exposing the ThreeUI StructureFlowCollection under the configured
// usage for this app. The nebula variant renders the vendored, hash-verified
// NebulaBackground component (see ../shaders/neuform-isolated/). The shared
// package stylesheet (../shaders/threeui.css) is vendored byte-for-byte next
// to the component; it is not imported into the app bundle because the
// registered nebula bundle does not ship its one external asset
// (./fonts/fragment-mono.woff2, used only by other variants' components) and
// none of its class-scoped rules apply to the nebula iframe, whose document
// carries its own styles.

import { NebulaBackground, type NeuformCraftEffectProps } from "../shaders/neuform-isolated/NeuformCraftEffects";

export type StructureFlowCollectionProps = NeuformCraftEffectProps & {
  variant: "nebula";
};

export function StructureFlowCollection({ variant, ...props }: StructureFlowCollectionProps) {
  if (variant !== "nebula") return null;
  return <NebulaBackground {...props} />;
}
