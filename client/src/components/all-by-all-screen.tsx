import { useState, useMemo, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Download, Upload, Play, CheckSquare, Square, Filter, FileJson, FileText, Terminal, Loader2 } from "lucide-react";
import Heatmap from "./heatmap";
import ScoreTable from "./score-table";
import Histogram from "./histogram";
import { parseFastaToProteins } from "@/lib/fasta";
import { generatePools } from "@/lib/pooling";
import { generateAF3Jobs } from "@/lib/af3-json";
import { analyzeResults, type ProteinInfo, type AnalysisResult } from "@/lib/analysis";
import { downloadExtractScript } from "@/lib/extract-script";

interface Pool {
  proteins: string[];
  totalResidues: number;
}

interface PoolingResult {
  pools: Pool[];
  coverageMatrix: number[][];
  proteinNames: string[];
  stats: any;
  af3Batches: any[][];
  descriptions: { job_number: string; proteins_tested: string }[];
}

export default function AllByAllScreen() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [step, setStep] = useState(1);
  const [poolResult, setPoolResult] = useState<PoolingResult | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customProteins, setCustomProteins] = useState<ProteinInfo[]>([]);
  const [presetProteins, setPresetProteins] = useState<ProteinInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load preset proteins from static JSON
  useEffect(() => {
    fetch("./data/gene_metadata.json")
      .then((res) => res.json())
      .then((data) => {
        setPresetProteins(data);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  const proteins = customMode ? customProteins : presetProteins;

  const categories = useMemo(() => {
    const cats = new Set(proteins.map((p) => p.category));
    return Array.from(cats).sort();
  }, [proteins]);

  const filteredProteins = useMemo(() => {
    return proteins.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          p.spd_locus.toLowerCase().includes(q) ||
          p.gene_name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [proteins, categoryFilter, searchQuery]);

  const toggleProtein = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredProteins.map((p) => p.spd_locus)));
  }, [filteredProteins]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Handle custom FASTA upload — client-side parsing
  const handleFastaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const parsed = parseFastaToProteins(text);
      setCustomProteins(parsed);
      setSelectedIds(new Set(parsed.map((p) => p.spd_locus)));
      setCustomMode(true);
      toast({ title: `Loaded ${parsed.length} proteins from FASTA` });
    } catch {
      toast({ title: "Failed to parse FASTA", variant: "destructive" });
    }
  };

  // Generate pools — client-side
  const handleGeneratePools = async () => {
    if (selectedIds.size < 2) {
      toast({ title: "Select at least 2 proteins", variant: "destructive" });
      return;
    }
    setIsGenerating(true);
    try {
      const proteinIds = Array.from(selectedIds);

      // Build protein list with sizes
      const proteinList = proteinIds.map((id) => {
        const meta = proteins.find(
          (g) => g.spd_locus === id || `${g.spd_locus}_${g.gene_name}` === id
        );
        const fastaKey = meta
          ? `${meta.spd_locus}_${meta.gene_name}`
          : id;
        return {
          id: fastaKey,
          length: meta?.aa_length || 0,
        };
      });

      const poolResult = generatePools(proteinList);

      // Build sequence map for AF3 JSON
      const seqMap = new Map<string, string>();
      for (const p of proteins) {
        const key = `${p.spd_locus}_${p.gene_name}`;
        if (p.sequence) seqMap.set(key, p.sequence);
      }

      const af3Result = generateAF3Jobs(poolResult.pools, seqMap, "spn_d39w");

      const stats = {
        totalPools: poolResult.pools.length,
        totalPairs: poolResult.pools.reduce(
          (sum, p) => sum + (p.proteins.length * (p.proteins.length - 1)) / 2,
          0
        ),
        residuesRange: poolResult.pools.length > 0 ? [
          Math.min(...poolResult.pools.map((p) => p.totalResidues)),
          Math.max(...poolResult.pools.map((p) => p.totalResidues)),
        ] : [0, 0],
        meanCoverage:
          poolResult.coverageMatrix.length > 0
            ? poolResult.coverageMatrix
                .flatMap((row, i) =>
                  row.filter((_, j) => j > i).filter((v) => v > 0)
                ).length /
              ((poolResult.proteinNames.length *
                (poolResult.proteinNames.length - 1)) /
                2)
            : 0,
      };

      setPoolResult({
        ...poolResult,
        stats,
        af3Batches: af3Result.batches,
        descriptions: af3Result.descriptions,
      });
      setStep(3);
      toast({ title: `Generated ${stats.totalPools} pools covering ${stats.totalPairs} pair tests` });
    } catch (err: any) {
      toast({ title: "Pool generation failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  // Download AF3 JSON batch files
  const downloadBatchFile = (batch: any[], index: number) => {
    const json = JSON.stringify(batch, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `spn_d39w_batch_${index + 1}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllBatches = () => {
    if (!poolResult) return;
    poolResult.af3Batches.forEach((batch, i) => downloadBatchFile(batch, i));
  };

  const downloadDescriptions = () => {
    if (!poolResult) return;
    let csv = "job_number,proteins_tested\n";
    for (const d of poolResult.descriptions) {
      csv += `${d.job_number},"${d.proteins_tested}"\n`;
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "job_descriptions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Upload and analyze results — client-side
  const handleUploadResults = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !poolResult) return;

    setIsAnalyzing(true);
    try {
      const confidenceFiles: { filename: string; data: any }[] = [];

      for (const file of Array.from(files)) {
        if (file.name.endsWith(".zip")) {
          const JSZip = (await import("jszip")).default;
          const zip = await JSZip.loadAsync(file);
          for (const [name, zipEntry] of Object.entries(zip.files)) {
            if (name.includes("summary_confidences") && name.endsWith(".json")) {
              const content = await (zipEntry as any).async("string");
              try {
                confidenceFiles.push({ filename: name.split("/").pop()!, data: JSON.parse(content) });
              } catch {}
            }
          }
        } else if (file.name.endsWith(".json") && file.name.includes("summary_confidences")) {
          const text = await file.text();
          try {
            confidenceFiles.push({ filename: file.name, data: JSON.parse(text) });
          } catch {}
        }
      }

      if (confidenceFiles.length === 0) {
        toast({ title: "No summary_confidences JSON files found", variant: "destructive" });
        setIsAnalyzing(false);
        return;
      }

      // Build protein sizes and metadata maps
      const proteinSizes = new Map<string, number>();
      const proteinMeta = new Map<string, ProteinInfo>();
      for (const p of proteins) {
        const key = `${p.spd_locus}_${p.gene_name}`;
        proteinSizes.set(key, p.aa_length);
        proteinMeta.set(key, p);
      }

      // Handle custom proteins from descriptions
      for (const d of poolResult.descriptions) {
        const prots = d.proteins_tested.split("::::");
        for (const p of prots) {
          if (!proteinSizes.has(p)) {
            proteinSizes.set(p, 300);
          }
        }
      }

      const result = analyzeResults(confidenceFiles, poolResult.descriptions, proteinSizes, proteinMeta);
      setAnalysisResult(result);
      setStep(5);
      toast({ title: `Analyzed ${confidenceFiles.length} confidence files, found ${result.pairwiseScores.length} pairs` });
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  // CSV downloads for results
  const downloadPairwiseCSV = () => {
    if (!analysisResult) return;
    let csv = "protein1,protein2,gene1,gene2,category1,category2,aa1,aa2,raw_iptm,sc_iptm,cross_category\n";
    for (const s of analysisResult.pairwiseScores) {
      csv += `${s.protein1},${s.protein2},${s.gene1},${s.gene2},${s.category1},${s.category2},${s.aa_length1},${s.aa_length2},${s.raw_iptm.toFixed(6)},${s.size_corrected_iptm.toFixed(6)},${s.cross_category}\n`;
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pairwise_scores.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadMatrixCSV = () => {
    if (!analysisResult) return;
    const { matrix, matrixLabels } = analysisResult;
    let csv = "," + matrixLabels.join(",") + "\n";
    for (let i = 0; i < matrix.length; i++) {
      csv += matrixLabels[i] + "," + matrix[i].map((v) => (isNaN(v) ? "" : v.toFixed(6))).join(",") + "\n";
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "iptm_matrix.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Category colors
  const categoryColors: Record<string, string> = {
    capsule: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    divisome: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    elongasome: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    hydrolase: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    PBP: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    PG_synthesis: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300",
    PG_modification: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
    custom: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
  };

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {[
          { n: 1, label: "Select Proteins" },
          { n: 3, label: "Generate Pools" },
          { n: 4, label: "Upload Results" },
          { n: 5, label: "Analyze" },
        ].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-border" />}
            <button
              onClick={() => {
                if (s.n <= step) setStep(s.n);
              }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors ${
                step >= s.n
                  ? "text-primary font-medium"
                  : "text-muted-foreground"
              }`}
              data-testid={`step-${s.n}`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  step >= s.n
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {i + 1}
              </span>
              {s.label}
            </button>
          </div>
        ))}
      </div>

      {/* Step 1: Select Proteins */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Select Proteins</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCustomMode(false);
                  setCustomProteins([]);
                  setSelectedIds(new Set());
                }}
                className={!customMode ? "border-primary" : ""}
                data-testid="btn-preset"
              >
                D39W Preset (73)
              </Button>
              <label>
                <Button variant="outline" size="sm" asChild>
                  <span className="cursor-pointer flex items-center gap-1.5">
                    <Upload size={13} />
                    Upload FASTA
                  </span>
                </Button>
                <input
                  type="file"
                  accept=".fasta,.fa,.fna,.txt"
                  className="hidden"
                  onChange={handleFastaUpload}
                  data-testid="input-fasta-upload"
                />
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-2">
              <Filter size={13} className="text-muted-foreground" />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-category-filter">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              placeholder="Search genes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-48 h-8 text-xs"
              data-testid="input-search"
            />
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="ghost" size="sm" onClick={selectAll} className="h-7 text-xs" data-testid="btn-select-all">
                <CheckSquare size={12} className="mr-1" />
                Select All
              </Button>
              <Button variant="ghost" size="sm" onClick={deselectAll} className="h-7 text-xs" data-testid="btn-deselect-all">
                <Square size={12} className="mr-1" />
                Deselect All
              </Button>
              <Badge variant="secondary" className="font-mono text-xs" data-testid="badge-selected-count">
                {selectedIds.size} selected
              </Badge>
            </div>
          </div>

          {/* Protein table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="animate-spin mr-2" size={16} />
              Loading proteins...
            </div>
          ) : (
            <div className="max-h-[320px] overflow-y-auto border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="text-xs">SPD Locus</TableHead>
                    <TableHead className="text-xs">Gene</TableHead>
                    <TableHead className="text-xs">Category</TableHead>
                    <TableHead className="text-xs text-right">Length (aa)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProteins.map((p) => (
                    <TableRow
                      key={p.spd_locus}
                      className="cursor-pointer hover:bg-accent/50"
                      onClick={() => toggleProtein(p.spd_locus)}
                      data-testid={`row-protein-${p.spd_locus}`}
                    >
                      <TableCell className="py-1.5">
                        <Checkbox
                          checked={selectedIds.has(p.spd_locus)}
                          onCheckedChange={() => toggleProtein(p.spd_locus)}
                        />
                      </TableCell>
                      <TableCell className="font-protein text-xs py-1.5">{p.spd_locus}</TableCell>
                      <TableCell className="font-medium text-xs py-1.5">{p.gene_name}</TableCell>
                      <TableCell className="py-1.5">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${categoryColors[p.category] || ""}`}>
                          {p.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs py-1.5">{p.aa_length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Generate button */}
          <div className="mt-4 flex items-center gap-3">
            <Button
              onClick={handleGeneratePools}
              disabled={selectedIds.size < 2 || isGenerating}
              className="flex items-center gap-2"
              data-testid="btn-generate-pools"
            >
              {isGenerating ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <Play size={14} />
              )}
              Generate Pools
            </Button>
            {selectedIds.size >= 2 && (
              <span className="text-xs text-muted-foreground">
                {selectedIds.size} proteins → {(selectedIds.size * (selectedIds.size - 1)) / 2} pairs to test
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Step 3: Pool Results & AF3 Downloads */}
      {poolResult && step >= 3 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pool Generation Results</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[
                { label: "Total Pools", value: poolResult.stats.totalPools },
                { label: "Pair Tests", value: poolResult.stats.totalPairs },
                {
                  label: "Residues/Pool",
                  value: `${poolResult.stats.residuesRange[0]}–${poolResult.stats.residuesRange[1]}`,
                },
                { label: "Proteins", value: poolResult.proteinNames.length },
              ].map((s) => (
                <div key={s.label} className="bg-muted/50 rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
                  <div className="text-lg font-semibold font-mono" data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Pool table */}
            <div className="max-h-[200px] overflow-y-auto border rounded-md mb-4">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-xs w-16">Pool #</TableHead>
                    <TableHead className="text-xs">Proteins</TableHead>
                    <TableHead className="text-xs text-right w-20">Residues</TableHead>
                    <TableHead className="text-xs text-right w-16">N</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {poolResult.pools.map((pool, i) => (
                    <TableRow key={i} data-testid={`row-pool-${i}`}>
                      <TableCell className="font-mono text-xs py-1.5">{i + 1}</TableCell>
                      <TableCell className="font-protein text-xs py-1.5 max-w-[400px] truncate">
                        {pool.proteins.map((p) => p.split("_").pop()).join(", ")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs py-1.5">{pool.totalResidues}</TableCell>
                      <TableCell className="text-right font-mono text-xs py-1.5">{pool.proteins.length}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Download buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadAllBatches} className="flex items-center gap-1.5" data-testid="btn-download-json">
                <FileJson size={13} />
                AF3 JSON Batches ({poolResult.af3Batches.length})
              </Button>
              <Button variant="outline" size="sm" onClick={downloadDescriptions} className="flex items-center gap-1.5" data-testid="btn-download-csv">
                <FileText size={13} />
                Description CSV
              </Button>
              <Button variant="outline" size="sm" onClick={downloadExtractScript} className="flex items-center gap-1.5" data-testid="btn-download-script">
                <Terminal size={13} />
                Extract Script
              </Button>
            </div>

            {/* Upload results */}
            <div className="mt-5 pt-4 border-t">
              <h3 className="text-sm font-medium mb-2">Upload AF3 Results</h3>
              <p className="text-xs text-muted-foreground mb-3">
                After running jobs on the AF3 server, use the extract script to get confidence files,
                then upload the resulting zip or individual JSON files.
              </p>
              <label>
                <Button variant="default" size="sm" asChild disabled={isAnalyzing}>
                  <span className="cursor-pointer flex items-center gap-1.5">
                    {isAnalyzing ? (
                      <Loader2 className="animate-spin" size={13} />
                    ) : (
                      <Upload size={13} />
                    )}
                    Upload Confidence Files
                  </span>
                </Button>
                <input
                  type="file"
                  accept=".json,.zip"
                  multiple
                  className="hidden"
                  onChange={handleUploadResults}
                  data-testid="input-confidence-upload"
                />
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 5: Analysis Results */}
      {analysisResult && step >= 5 && (
        <div className="space-y-5">
          {/* Downloads bar */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadPairwiseCSV} className="flex items-center gap-1.5" data-testid="btn-download-pairwise">
              <Download size={13} />
              Pairwise Scores CSV
            </Button>
            <Button variant="outline" size="sm" onClick={downloadMatrixCSV} className="flex items-center gap-1.5" data-testid="btn-download-matrix">
              <Download size={13} />
              Matrix CSV
            </Button>
          </div>

          {/* Heatmap */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Interaction Heatmap (size-corrected ipTM)</CardTitle>
            </CardHeader>
            <CardContent>
              <Heatmap
                matrix={analysisResult.matrix}
                labels={analysisResult.matrixLabels}
                categories={analysisResult.categoryOrder}
                categoryColors={categoryColors}
              />
            </CardContent>
          </Card>

          {/* Score distribution */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Score Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <Histogram scores={analysisResult.pairwiseScores.map((s) => s.size_corrected_iptm)} />
            </CardContent>
          </Card>

          {/* Top hits table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pairwise Interaction Scores</CardTitle>
            </CardHeader>
            <CardContent>
              <ScoreTable scores={analysisResult.pairwiseScores} categoryColors={categoryColors} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
