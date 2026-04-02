import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Play, Upload, Download, FileJson, FileText, Terminal, Loader2 } from "lucide-react";
import Histogram from "./histogram";
import { parseFastaToProteins, parseProteomeFasta } from "@/lib/fasta";
import { generateProteomeWidePools } from "@/lib/pooling";
import { generateAF3Jobs } from "@/lib/af3-json";
import { analyzeResults, type ProteinInfo } from "@/lib/analysis";
import { downloadExtractScript } from "@/lib/extract-script";

export default function ProteomeWideScreen() {
  const { toast } = useToast();
  const [queryProteinId, setQueryProteinId] = useState<string>("");
  const [customSequence, setCustomSequence] = useState("");
  const [customQueryName, setCustomQueryName] = useState("query");
  const [proteomeProteins, setProteomeProteins] = useState<any[]>([]);
  const [usePresetProteome, setUsePresetProteome] = useState(true);
  const [isLoadingProteome, setIsLoadingProteome] = useState(false);
  const [poolResult, setPoolResult] = useState<any>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [presetProteins, setPresetProteins] = useState<ProteinInfo[]>([]);

  // Load preset proteins from static JSON
  useEffect(() => {
    fetch("./data/gene_metadata.json")
      .then((res) => res.json())
      .then((data) => setPresetProteins(data))
      .catch(() => {});
  }, []);

  // Upload proteome FASTA (user provides their own file)
  const handleProteomeFastaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoadingProteome(true);
    try {
      const text = await file.text();
      const parsed = parseProteomeFasta(text);
      setProteomeProteins(parsed);
      setUsePresetProteome(false);
      toast({ title: `Loaded ${parsed.length} target proteins` });
    } catch {
      toast({ title: "Failed to parse FASTA", variant: "destructive" });
    } finally {
      setIsLoadingProteome(false);
    }
  };

  // Load full D39W proteome (1,910 proteins)
  const loadFullProteome = async () => {
    setIsLoadingProteome(true);
    try {
      const res = await fetch("./data/d39w_proteome.json");
      const data = await res.json();
      const proteome = data.map((p: any) => ({
        id: p.gene_name || p.id,
        full_header: p.id,
        aa_length: p.length,
        sequence: p.sequence,
      }));
      setProteomeProteins(proteome);
      setUsePresetProteome(false);
      toast({ title: `Loaded full D39W proteome: ${proteome.length} proteins` });
    } catch {
      toast({ title: "Failed to load proteome", variant: "destructive" });
    } finally {
      setIsLoadingProteome(false);
    }
  };

  // Use the preset 73 proteins as a mini-proteome for quick testing
  const loadPresetAsProteome = () => {
    const proteome = presetProteins.map((p) => ({
      id: `${p.spd_locus}_${p.gene_name}`,
      full_header: `${p.spd_locus}_${p.gene_name}`,
      aa_length: p.aa_length,
      sequence: p.sequence || "",
    }));
    setProteomeProteins(proteome);
    setUsePresetProteome(true);
    toast({ title: `Loaded ${proteome.length} D39W subset proteins as target proteome` });
  };

  // Get query protein info
  const getQueryProtein = () => {
    if (queryProteinId && !customSequence) {
      const preset = presetProteins.find((p) => p.spd_locus === queryProteinId);
      if (preset) {
        return {
          id: `${preset.spd_locus}_${preset.gene_name}`,
          length: preset.aa_length,
          sequence: preset.sequence || "",
        };
      }
    }
    if (customSequence) {
      const seq = customSequence.replace(/\s+/g, "").replace(/^>.*\n/, "");
      return {
        id: customQueryName || "query",
        length: seq.length,
        sequence: seq,
      };
    }
    return null;
  };

  // Generate pools — client-side
  const handleGenerate = async () => {
    const query = getQueryProtein();
    if (!query) {
      toast({ title: "Select or paste a query protein", variant: "destructive" });
      return;
    }
    if (proteomeProteins.length === 0) {
      toast({ title: "Load a target proteome first", variant: "destructive" });
      return;
    }

    setIsGenerating(true);
    try {
      const targets = proteomeProteins.map((p: any) => ({
        id: p.id,
        length: p.aa_length,
        sequence: p.sequence,
      }));

      const result = generateProteomeWidePools(query, targets);

      // Build sequence map
      const seqMap = new Map<string, string>();
      seqMap.set(query.id, query.sequence);
      for (const t of proteomeProteins) {
        seqMap.set(t.id, t.sequence);
      }

      const af3Result = generateAF3Jobs(result.pools, seqMap, "proteome_screen");

      setPoolResult({
        pools: result.pools,
        proteinNames: result.proteinNames,
        stats: {
          totalPools: result.pools.length,
          totalPairs: result.pools.reduce((s: number, p: any) => s + (p.proteins.length - 1), 0),
          residuesRange: result.pools.length > 0 ? [
            Math.min(...result.pools.map((p) => p.totalResidues)),
            Math.max(...result.pools.map((p) => p.totalResidues)),
          ] : [0, 0],
        },
        af3Batches: af3Result.batches,
        descriptions: af3Result.descriptions,
      });
      toast({ title: `Generated ${result.pools.length} pools screening against ${proteomeProteins.length} proteins` });
    } catch (err: any) {
      toast({ title: "Pool generation failed", description: err.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  // Download helpers
  const downloadBatches = () => {
    if (!poolResult) return;
    poolResult.af3Batches.forEach((batch: any[], i: number) => {
      const json = JSON.stringify(batch, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `proteome_screen_batch_${i + 1}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
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
    a.download = "proteome_screen_descriptions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Upload results — client-side analysis
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
        } else if (file.name.endsWith(".json")) {
          const text = await file.text();
          try {
            confidenceFiles.push({ filename: file.name, data: JSON.parse(text) });
          } catch {}
        }
      }

      if (confidenceFiles.length === 0) {
        toast({ title: "No confidence files found", variant: "destructive" });
        setIsAnalyzing(false);
        return;
      }

      // Build protein sizes and metadata maps
      const proteinSizes = new Map<string, number>();
      const proteinMeta = new Map<string, ProteinInfo>();

      // Add preset proteins
      for (const p of presetProteins) {
        const key = `${p.spd_locus}_${p.gene_name}`;
        proteinSizes.set(key, p.aa_length);
        proteinMeta.set(key, p);
      }

      // Add proteome proteins
      for (const p of proteomeProteins) {
        if (!proteinSizes.has(p.id)) {
          proteinSizes.set(p.id, p.aa_length);
          proteinMeta.set(p.id, {
            spd_locus: p.id,
            gene_name: p.id,
            category: "target",
            aa_length: p.aa_length,
          });
        }
      }

      // Handle any from descriptions
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
      toast({ title: `Analyzed ${confidenceFiles.length} files` });
    } catch (err: any) {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const downloadHitsCSV = () => {
    if (!analysisResult) return;
    let csv = "rank,protein,gene,category,aa_length,raw_iptm,sc_iptm\n";
    analysisResult.pairwiseScores.forEach((s: any, i: number) => {
      csv += `${i + 1},${s.protein2},${s.gene2},${s.category2},${s.aa_length2},${s.raw_iptm.toFixed(6)},${s.size_corrected_iptm.toFixed(6)}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "proteome_screen_hits.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Query protein selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Query Protein</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Select from D39W preset:
              </label>
              <Select value={queryProteinId} onValueChange={(v) => { setQueryProteinId(v); setCustomSequence(""); }}>
                <SelectTrigger className="h-8 text-xs" data-testid="select-query-protein">
                  <SelectValue placeholder="Choose a protein..." />
                </SelectTrigger>
                <SelectContent>
                  {presetProteins.map((p) => (
                    <SelectItem key={p.spd_locus} value={p.spd_locus}>
                      <span className="font-protein">{p.gene_name}</span>
                      <span className="text-muted-foreground ml-2">({p.spd_locus}, {p.aa_length} aa)</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Or paste custom sequence:
              </label>
              <Input
                placeholder="Custom query name"
                value={customQueryName}
                onChange={(e) => setCustomQueryName(e.target.value)}
                className="h-8 text-xs mb-1"
                data-testid="input-custom-query-name"
              />
              <Textarea
                placeholder="Paste protein sequence (FASTA or raw)..."
                value={customSequence}
                onChange={(e) => { setCustomSequence(e.target.value); setQueryProteinId(""); }}
                className="h-20 text-xs font-protein"
                data-testid="textarea-custom-sequence"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Target proteome */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Target Proteome</CardTitle>
            <Badge variant="secondary" className="font-mono text-xs">
              {proteomeProteins.length > 0 ? `${proteomeProteins.length} proteins loaded` : "No proteome loaded"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={loadFullProteome}
              disabled={isLoadingProteome}
              data-testid="btn-load-full-proteome"
            >
              {isLoadingProteome ? <Loader2 className="animate-spin mr-1" size={13} /> : null}
              D39W Full Proteome (1,910)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={loadPresetAsProteome}
              disabled={isLoadingProteome || presetProteins.length === 0}
              data-testid="btn-load-proteome"
            >
              D39W Subset ({presetProteins.length})
            </Button>
            <span className="text-xs text-muted-foreground">or</span>
            <label>
              <Button variant="outline" size="sm" asChild>
                <span className="cursor-pointer flex items-center gap-1.5">
                  <Upload size={13} />
                  Upload Custom FASTA
                </span>
              </Button>
              <input
                type="file"
                accept=".fasta,.fa,.fna,.txt"
                className="hidden"
                onChange={handleProteomeFastaUpload}
                data-testid="input-proteome-fasta"
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            D39W reference proteome (UP000001452) from{" "}
            <a
              href="https://www.uniprot.org/proteomes/UP000001452"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              UniProt
            </a>.
            Full proteome is pre-loaded (1,910 proteins). Subset contains the 73 cell wall/division proteins.
          </p>

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !getQueryProtein() || proteomeProteins.length === 0}
            className="flex items-center gap-2"
            data-testid="btn-generate-proteome-pools"
          >
            {isGenerating ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
            Generate Proteome-Wide Pools
          </Button>
        </CardContent>
      </Card>

      {/* Pool results */}
      {poolResult && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Proteome Screen Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              {[
                { label: "Total Pools", value: poolResult.stats.totalPools },
                { label: "Proteins Screened", value: poolResult.stats.totalPairs },
                {
                  label: "Residues/Pool",
                  value: `${poolResult.stats.residuesRange[0]}–${poolResult.stats.residuesRange[1]}`,
                },
              ].map((s) => (
                <div key={s.label} className="bg-muted/50 rounded-md px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
                  <div className="text-lg font-semibold font-mono">{s.value}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Button variant="outline" size="sm" onClick={downloadBatches} className="flex items-center gap-1.5" data-testid="btn-pw-download-json">
                <FileJson size={13} />
                AF3 JSON ({poolResult.af3Batches.length} batches)
              </Button>
              <Button variant="outline" size="sm" onClick={downloadDescriptions} className="flex items-center gap-1.5" data-testid="btn-pw-download-csv">
                <FileText size={13} />
                Description CSV
              </Button>
              <Button variant="outline" size="sm" onClick={downloadExtractScript} className="flex items-center gap-1.5">
                <Terminal size={13} />
                Extract Script
              </Button>
            </div>

            {/* Upload results */}
            <div className="pt-4 border-t">
              <h3 className="text-sm font-medium mb-2">Upload AF3 Results</h3>
              <label>
                <Button variant="default" size="sm" asChild disabled={isAnalyzing}>
                  <span className="cursor-pointer flex items-center gap-1.5">
                    {isAnalyzing ? <Loader2 className="animate-spin" size={13} /> : <Upload size={13} />}
                    Upload Confidence Files
                  </span>
                </Button>
                <input type="file" accept=".json,.zip" multiple className="hidden" onChange={handleUploadResults} data-testid="input-pw-confidence" />
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Analysis results */}
      {analysisResult && (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={downloadHitsCSV} className="flex items-center gap-1.5" data-testid="btn-pw-download-hits">
              <Download size={13} />
              Ranked Hits CSV
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Score Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <Histogram scores={analysisResult.pairwiseScores.map((s: any) => s.size_corrected_iptm)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Ranked Hits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[500px] overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="text-xs w-12">Rank</TableHead>
                      <TableHead className="text-xs">Protein</TableHead>
                      <TableHead className="text-xs">Gene</TableHead>
                      <TableHead className="text-xs text-right">sc_ipTM</TableHead>
                      <TableHead className="text-xs text-right">Raw ipTM</TableHead>
                      <TableHead className="text-xs text-right">Length</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analysisResult.pairwiseScores.map((s: any, i: number) => (
                      <TableRow key={i} data-testid={`row-hit-${i}`}>
                        <TableCell className="font-mono text-xs py-1.5">{i + 1}</TableCell>
                        <TableCell className="font-protein text-xs py-1.5">{s.protein2}</TableCell>
                        <TableCell className="text-xs py-1.5 font-medium">{s.gene2}</TableCell>
                        <TableCell className="text-right font-mono text-xs py-1.5">
                          <span className={s.size_corrected_iptm > 0.2 ? "text-primary font-semibold" : ""}>
                            {s.size_corrected_iptm.toFixed(4)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs py-1.5">{s.raw_iptm.toFixed(4)}</TableCell>
                        <TableCell className="text-right font-mono text-xs py-1.5">{s.aa_length2}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
