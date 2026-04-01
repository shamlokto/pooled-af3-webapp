export const EXTRACT_SCRIPT = `#!/bin/bash
# Extract summary_confidences JSONs from AlphaFold3 result zips
# Usage: Place all AF3 result .zip files in the current directory, then run this script.

mkdir -p af3_confidences

for zip in *.zip; do
    [ -f "$zip" ] || continue
    echo "Processing: $zip"
    unzip -j -o "$zip" "*summary_confidences*.json" -d af3_confidences/ 2>/dev/null
done

echo ""
echo "Extracted $(ls af3_confidences/*.json 2>/dev/null | wc -l) confidence files."

# Create a single zip for upload
zip -j af3_confidences_all.zip af3_confidences/*.json 2>/dev/null

echo ""
echo "Created: af3_confidences_all.zip"
echo "Upload this file to the Pooled-AF3 web app for analysis."
`;

export function downloadExtractScript() {
  const blob = new Blob([EXTRACT_SCRIPT], { type: "application/x-shellscript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "extract_confidences.sh";
  a.click();
  URL.revokeObjectURL(url);
}
