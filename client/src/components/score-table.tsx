import { useState, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Search } from "lucide-react";

interface PairwiseScore {
  protein1: string;
  protein2: string;
  gene1: string;
  gene2: string;
  category1: string;
  category2: string;
  aa_length1: number;
  aa_length2: number;
  raw_iptm: number;
  size_corrected_iptm: number;
  cross_category: boolean;
}

interface ScoreTableProps {
  scores: PairwiseScore[];
  categoryColors: Record<string, string>;
}

export default function ScoreTable({ scores, categoryColors }: ScoreTableProps) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"sc_iptm" | "raw_iptm" | "gene1" | "gene2">("sc_iptm");
  const [sortDesc, setSortDesc] = useState(true);
  const [crossOnly, setCrossOnly] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const filtered = useMemo(() => {
    let data = [...scores];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(
        (s) =>
          s.gene1.toLowerCase().includes(q) ||
          s.gene2.toLowerCase().includes(q) ||
          s.protein1.toLowerCase().includes(q) ||
          s.protein2.toLowerCase().includes(q) ||
          s.category1.toLowerCase().includes(q) ||
          s.category2.toLowerCase().includes(q)
      );
    }
    if (crossOnly) {
      data = data.filter((s) => s.cross_category);
    }
    data.sort((a, b) => {
      let va: any, vb: any;
      switch (sortBy) {
        case "sc_iptm":
          va = a.size_corrected_iptm;
          vb = b.size_corrected_iptm;
          break;
        case "raw_iptm":
          va = a.raw_iptm;
          vb = b.raw_iptm;
          break;
        case "gene1":
          va = a.gene1;
          vb = b.gene1;
          break;
        case "gene2":
          va = a.gene2;
          vb = b.gene2;
          break;
      }
      if (typeof va === "string") {
        return sortDesc ? vb.localeCompare(va) : va.localeCompare(vb);
      }
      return sortDesc ? vb - va : va - vb;
    });
    return data;
  }, [scores, search, sortBy, sortDesc, crossOnly]);

  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(filtered.length / pageSize);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDesc(!sortDesc);
    else {
      setSortBy(col);
      setSortDesc(true);
    }
    setPage(0);
  };

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search genes or categories..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="h-8 text-xs pl-8"
            data-testid="input-score-search"
          />
        </div>
        <Button
          variant={crossOnly ? "default" : "outline"}
          size="sm"
          onClick={() => { setCrossOnly(!crossOnly); setPage(0); }}
          className="h-8 text-xs"
          data-testid="btn-cross-category"
        >
          Cross-category only
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} pairs
        </span>
      </div>

      <div className="max-h-[500px] overflow-y-auto border rounded-md">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead className="text-xs w-10">#</TableHead>
              <TableHead className="text-xs cursor-pointer" onClick={() => toggleSort("gene1")}>
                <span className="flex items-center gap-1">
                  Gene 1 <ArrowUpDown size={10} />
                </span>
              </TableHead>
              <TableHead className="text-xs cursor-pointer" onClick={() => toggleSort("gene2")}>
                <span className="flex items-center gap-1">
                  Gene 2 <ArrowUpDown size={10} />
                </span>
              </TableHead>
              <TableHead className="text-xs">Categories</TableHead>
              <TableHead className="text-xs text-right cursor-pointer" onClick={() => toggleSort("sc_iptm")}>
                <span className="flex items-center gap-1 justify-end">
                  sc_ipTM <ArrowUpDown size={10} />
                </span>
              </TableHead>
              <TableHead className="text-xs text-right cursor-pointer" onClick={() => toggleSort("raw_iptm")}>
                <span className="flex items-center gap-1 justify-end">
                  Raw ipTM <ArrowUpDown size={10} />
                </span>
              </TableHead>
              <TableHead className="text-xs text-right">Sizes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.map((s, i) => (
              <TableRow key={`${s.protein1}-${s.protein2}`} data-testid={`row-score-${page * pageSize + i}`}>
                <TableCell className="font-mono text-xs py-1.5 text-muted-foreground">
                  {page * pageSize + i + 1}
                </TableCell>
                <TableCell className="font-medium text-xs py-1.5">{s.gene1}</TableCell>
                <TableCell className="font-medium text-xs py-1.5">{s.gene2}</TableCell>
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 ${categoryColors[s.category1] || ""}`}>
                      {s.category1}
                    </Badge>
                    {s.cross_category && <span className="text-[9px] text-muted-foreground">×</span>}
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 ${categoryColors[s.category2] || ""}`}>
                      {s.category2}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-xs py-1.5">
                  <span
                    className={
                      s.size_corrected_iptm > 0.3
                        ? "text-primary font-bold"
                        : s.size_corrected_iptm > 0.15
                        ? "text-primary font-medium"
                        : ""
                    }
                  >
                    {s.size_corrected_iptm.toFixed(4)}
                  </span>
                </TableCell>
                <TableCell className="text-right font-mono text-xs py-1.5">{s.raw_iptm.toFixed(4)}</TableCell>
                <TableCell className="text-right font-mono text-xs py-1.5 text-muted-foreground">
                  {s.aa_length1}+{s.aa_length2}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <Button variant="ghost" size="sm" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
