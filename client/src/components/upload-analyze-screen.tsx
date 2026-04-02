import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, Terminal, Loader2, FileJson, FileText, Info, CheckCircle2, AlertCircle } from "lucide-react";
import Histogram from "./histogram";
import Heatmap from "./heatmap";
import { analyzeResults, type ProteinInfo } from "@/lib/analysis";
import { downloadExtractScript } from "@/lib/extract-script";

export default function UploadAnalyzeScreen() {
  const { toast } = useToast();
  const [descriptionFile, setDescriptionFile] = useState<any[] | null>(null);
  const [descriptionFileName, setDescriptionFileName] = useState("");
  const [confidenceFiles, setConfidenceFiles] = useState<{ filename: string; data: any }[]>([]);
  const [proteinSizes, setProteinSizes] = useState<Map<string, number>>(new Map());
  const [proteinMeta, setProteinMeta] = useState<Map<string, ProteinInfo>>(new Map());
  const [presetProteins, setPresetProteins] = useState<ProteinInfo[]>([]);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const confInputRef = useRef<HTMLInputElement>(null);

  // Load preset proteins for metadata lookup
  useEffect(() => {
    fetch("./data/gene_metadata.json")
      .then((res) => res.json())
      .then((data) => {
        setPresetProteins(data);
        const sizes = new Map<string, number>();
        const meta = new Map<string, ProteinInfo>();
        for (const p of data) {
          const key = `${p.spd_locus}_${p.gene_name}`;
          sizes.set(key, p.aa_length);
          meta.set(key, p);
        }
        setProteinSizes(sizes);
        setProteinMeta(meta);
      })
      .catch(() => {});
  }, []);

  // Parse description CSV
  const handleDescriptionUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.trim().split("\n");
      const header = lines[0].split(",");
      const descriptions = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",");
        // Handle quoted fields
        const jobNumber = cols[0]?.replace(/"/g, "").trim();
        // Everything after first comma until next unquoted comma is proteins_tested
        const rest = lines[i].substring(lines[i].indexOf(",") + 1);
        const proteinsTested = rest.replace(/"/g, "").trim();
        if (jobNumber && proteinsTested) {
          descriptions.push({
            job_number: jobNumber,
            proteins_tested: proteinsTested,
          });

          // Extract protein names and estimate sizes if not known
          const prots = proteinsTested.split("::::");
          for (const p of prots) {
            if (!proteinSizes.has(p)) {
              proteinSizes.set(p, 300); // default estimate
            }
          }
        }
      }
      setDescriptionFile(descriptions);
      setDescriptionFileName(file.name);
      setProteinSizes(new Map(proteinSizes));
      toast({ title: `Loaded ${descriptions.length} job descriptions from ${file.name}` });
    } catch {
      toast({ title: "Failed to parse description CSV", variant: "destructive" });
    }
  };

  // Parse confidence files (JSON or ZIP)
  const handleConfidenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles: { filename: string; data: any }[] = [...confidenceFiles];

    for (const file of Array.from(files)) {
      if (file.name.endsWith(".zip")) {
        try {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(file);
          for (const [name, zipEntry] of Object.entries(zip.files)) {
            if (name.includes("summary_confidences") && name.endsWith(".json") && !name.startsWith("__MACOSX")) {
              const content = await (zipEntry as any).async("string");
              try {
                newFiles.push({ filename: name.split("/").pop()!, data: JSON.parse(content) });
              } catch {}
            }
          }
        } catch {
          toast({ title: `Failed to read ${file.name}`, variant: "destructive" });
        }
      } else if (file.name.endsWith(".json")) {
        try {
          const text = await file.text();
          newFiles.push({ filename: file.name, data: JSON.parse(text) });
        } catch {}
      }
    }

    setConfidenceFiles(newFiles);
    toast({ title: `${newFiles.length} confidence files loaded` });
    // Reset input so the same file can be re-uploaded
    if (confInputRef.current) confInputRef.current.value = "";
  };

  // Also let user upload a FASTA to provide accurate protein sizes
  const handleFastaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.split("\n");
      const sizes = new Map(proteinSizes);
      const meta = new Map(proteinMeta);
      let currentId = "";
      let currentSeq = "";

      const flush = () => {
        if (currentId && currentSeq) {
          sizes.set(currentId, currentSeq.length);
          if (!meta.has(currentId)) {
            const gene = currentId.includes("_") ? currentId.split("_").pop() || currentId : currentId;
            meta.set(currentId, {
              spd_locus: currentId.split("_").slice(0, 2).join("_"),
              gene_name: gene,
              category: "unknown",
              aa_length: currentSeq.length,
            });
          }
        }
      };

      for (const line of lines) {
        if (line.startsWith(">")) {
          flush();
          currentId = line.substring(1).trim().split(/\s/)[0];
          currentSeq = "";
        } else {
          currentSeq += line.trim();
        }
      }
      flush();

      setProteinSizes(sizes);
      setProteinMeta(meta);
      toast({ title: `Loaded sizes for ${sizes.size} proteins from FASTA` });
    } catch {
      toast({ title: "Failed to parse FASTA", variant: "destructive" });
    }
  };

  // Run analysis
  const runAnalysis = () => {
    if (!descriptionFile || confidenceFiles.length === 0) {
      toast({ title: "Upload both description CSV and confidence files first", variant: "destructive" });
      return;
    }

    setIsAnalyzing(true);
    try {
      // Small timeout to let UI update
      setTimeout(() => {
        try {
          const result = analyzeResults(confidenceFiles, descriptionFile, proteinSizes, proteinMeta);
          setAnalysisResult(result);
          toast({ title: `Analysis complete: ${result.pairwiseScores.length} pairs scored` });
        } catch (err: any) {
          toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
        } finally {
          setIsAnalyzing(false);
        }
      }, 50);
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
      setIsAnalyzing(false);
    }
  };

  // Download results
  const downloadPairwiseCSV = () => {
    if (!analysisResult) return;
    let csv = "rank,protein1,protein2,gene1,gene2,category1,category2,aa_length1,aa_length2,size_corrected_iptm,raw_iptm,cross_category\n";
    analysisResult.pairwiseScores.forEach((s: any, i: number) => {
      csv += `${i + 1},${s.protein1},${s.protein2},${s.gene1},${s.gene2},${s.category1},${s.category2},${s.aa_length1},${s.aa_length2},${s.size_corrected_iptm.toFixed(6)},${s.raw_iptm.toFixed(6)},${s.cross_category}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pairwise_scores.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadMatrixCSV = () => {
    if (!analysisResult?.matrix) return;
    const { matrix, proteinNames } = analysisResult;
    let csv = "," + proteinNames.join(",") + "\n";
    for (let i = 0; i < proteinNames.length; i++) {
      csv += proteinNames[i];
      for (let j = 0; j < proteinNames.length; j++) {
        csv += "," + (matrix[i]?.[j] != null ? matrix[i][j].toFixed(6) : "");
      }
      csv += "\n";
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "all_by_all_matrix.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Count unique jobs in confidence files
  const jobsCovered = new Set(
    confidenceFiles.map((f) => {
      const match = f.filename.match(/fold_(.+?)_summary_confidences/);
      return match ? match[1] : f.filename;
    })
  );

  return (
    <div className="space-y-5">
      {/* Step 1: Extract script */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Step 1: Extract Confidence Files from AF3 Results</CardTitle>
            <Badge variant="outline" className="text-xs">Helper Script</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            After downloading your AF3 result zip files, run this script to extract only the small confidence
            JSON files needed for analysis. This reduces ~4 GB of zips to ~300 KB.
          </p>
          <div className="bg-muted/50 rounded-md p-3 font-mono text-xs leading-relaxed">
            <div className="text-muted-foreground mb-1"># Place all AF3 result zips in one folder, then run:</div>
            <div>bash extract_confidences.sh</div>
            <div className="text-muted-foreground mt-1"># Upload the resulting af3_confidences_all.zip below</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadExtractScript}
            className="flex items-center gap-1.5"
            data-testid="btn-download-script"
          >
            <Terminal size={13} />
            Download extract_confidences.sh
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Upload files */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 2: Upload Data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Description CSV */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Description CSV</h3>
              {descriptionFile ? (
                <Badge className="bg-green-100 text-green-800 text-[10px]">
                  <CheckCircle2 size={10} className="mr-1" />
                  {descriptionFile.length} jobs
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  <AlertCircle size={10} className="mr-1" />
                  Required
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The description CSV maps job names to protein lists. Generated in the All-by-All or One-by-All tabs.
            </p>
            <label>
              <Button variant="outline" size="sm" asChild>
                <span className="cursor-pointer flex items-center gap-1.5">
                  <FileText size={13} />
                  {descriptionFileName || "Upload Description CSV"}
                </span>
              </Button>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleDescriptionUpload}
                data-testid="input-desc-csv"
              />
            </label>
          </div>

          {/* Confidence files */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Confidence Files</h3>
              {confidenceFiles.length > 0 ? (
                <Badge className="bg-green-100 text-green-800 text-[10px]">
                  <CheckCircle2 size={10} className="mr-1" />
                  {confidenceFiles.length} files ({jobsCovered.size} jobs)
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  <AlertCircle size={10} className="mr-1" />
                  Required
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Upload the extracted <span className="font-mono">summary_confidences</span> JSON files, or a zip containing them.
              You can upload multiple times — files accumulate.
            </p>
            <label>
              <Button variant="outline" size="sm" asChild>
                <span className="cursor-pointer flex items-center gap-1.5">
                  <FileJson size={13} />
                  Upload Confidence Files / ZIP
                </span>
              </Button>
              <input
                ref={confInputRef}
                type="file"
                accept=".json,.zip"
                multiple
                className="hidden"
                onChange={handleConfidenceUpload}
                data-testid="input-confidence-files"
              />
            </label>
            {confidenceFiles.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => { setConfidenceFiles([]); setAnalysisResult(null); }}
              >
                Clear all files
              </Button>
            )}
          </div>

          {/* Optional: FASTA for accurate sizes */}
          <div className="space-y-2 pt-2 border-t">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">Protein FASTA</h3>
              <Badge variant="secondary" className="text-[10px]">Optional</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Upload the FASTA file used for pool generation. This provides accurate protein sizes for the
              size correction. If not provided, D39W preset sizes are used for known proteins (default 300 aa for unknown).
            </p>
            <label>
              <Button variant="outline" size="sm" asChild>
                <span className="cursor-pointer flex items-center gap-1.5">
                  <Upload size={13} />
                  Upload FASTA (optional)
                </span>
              </Button>
              <input
                type="file"
                accept=".fasta,.fa,.fna,.txt"
                className="hidden"
                onChange={handleFastaUpload}
                data-testid="input-fasta-sizes"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Run analysis */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 3: Analyze</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info size={12} />
            <span>
              Size correction uses published coefficients: expected_ipTM = −0.0363 + 0.00447 × √(aa₁ + aa₂)
            </span>
          </div>
          <Button
            onClick={runAnalysis}
            disabled={isAnalyzing || !descriptionFile || confidenceFiles.length === 0}
            className="flex items-center gap-2"
            data-testid="btn-run-analysis"
          >
            {isAnalyzing ? <Loader2 className="animate-spin" size={14} /> : <FileJson size={14} />}
            Run Analysis
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {analysisResult && (
        <div className="space-y-5">
          {/* Summary stats */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Results Summary</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={downloadPairwiseCSV} className="flex items-center gap-1.5" data-testid="btn-download-pairwise">
                    <Download size={13} />
                    Pairwise Scores CSV
                  </Button>
                  {analysisResult.matrix && (
                    <Button variant="outline" size="sm" onClick={downloadMatrixCSV} className="flex items-center gap-1.5" data-testid="btn-download-matrix">
                      <Download size={13} />
                      Matrix CSV
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "Pairs Scored", value: analysisResult.pairwiseScores.length },
                  { label: "Jobs Processed", value: jobsCovered.size },
                  { label: "Confidence Files", value: confidenceFiles.length },
                  {
                    label: "Top sc_ipTM",
                    value: analysisResult.pairwiseScores.length > 0
                      ? analysisResult.pairwiseScores[0].size_corrected_iptm.toFixed(4)
                      : "—",
                  },
                ].map((s) => (
                  <div key={s.label} className="bg-muted/50 rounded-md px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
                    <div className="text-lg font-semibold font-mono">{s.value}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Score distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Score Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <Histogram scores={analysisResult.pairwiseScores.map((s: any) => s.size_corrected_iptm)} />
            </CardContent>
          </Card>

          {/* Heatmap */}
          {analysisResult.matrix && analysisResult.proteinNames && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Interaction Heatmap</CardTitle>
              </CardHeader>
              <CardContent>
                <Heatmap
                  matrix={analysisResult.matrix}
                  labels={analysisResult.proteinNames.map((n: string) => {
                    const parts = n.split("_");
                    return parts.length >= 3 ? parts.slice(2).join("_") : n;
                  })}
                  categories={analysisResult.proteinNames.map((n: string) => {
                    const meta = proteinMeta.get(n);
                    return meta?.category || "unknown";
                  })}
                />
              </CardContent>
            </Card>
          )}

          {/* Top hits table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Top Interactions (ranked by size-corrected ipTM)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[600px] overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="text-xs w-12">Rank</TableHead>
                      <TableHead className="text-xs">Protein 1</TableHead>
                      <TableHead className="text-xs">Protein 2</TableHead>
                      <TableHead className="text-xs">Category 1</TableHead>
                      <TableHead className="text-xs">Category 2</TableHead>
                      <TableHead className="text-xs text-right">sc_ipTM</TableHead>
                      <TableHead className="text-xs text-right">Raw ipTM</TableHead>
                      <TableHead className="text-xs text-center">Cross</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysisResult.pairwiseScores.slice(0, 200).map((s: any, i: number) => (
                      <TableRow key={i} data-testid={`row-pair-${i}`}>
                        <TableCell className="font-mono text-xs py-1.5">{i + 1}</TableCell>
                        <TableCell className="font-protein text-xs py-1.5">{s.gene1}</TableCell>
                        <TableCell className="font-protein text-xs py-1.5">{s.gene2}</TableCell>
                        <TableCell className="text-xs py-1.5">
                          <Badge variant="secondary" className="text-[10px] font-normal">{s.category1}</Badge>
                        </TableCell>
                        <TableCell className="text-xs py-1.5">
                          <Badge variant="secondary" className="text-[10px] font-normal">{s.category2}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs py-1.5">
                          <span className={s.size_corrected_iptm > 0.2 ? "text-primary font-semibold" : s.size_corrected_iptm > 0.1 ? "text-blue-500" : ""}>
                            {s.size_corrected_iptm.toFixed(4)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs py-1.5">{s.raw_iptm.toFixed(4)}</TableCell>
                        <TableCell className="text-center text-xs py-1.5">
                          {s.cross_category ? <Badge variant="outline" className="text-[10px]">cross</Badge> : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {analysisResult.pairwiseScores.length > 200 && (
                <p className="text-xs text-muted-foreground mt-2">
                  Showing top 200 of {analysisResult.pairwiseScores.length} pairs. Download the full CSV for all results.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
