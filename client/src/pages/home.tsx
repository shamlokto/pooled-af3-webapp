import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AllByAllScreen from "@/components/all-by-all-screen";
import ProteomeWideScreen from "@/components/proteome-wide-screen";
import UploadAnalyzeScreen from "@/components/upload-analyze-screen";
import { FlaskConical, Globe, Upload, Github } from "lucide-react";

export default function Home() {
  const [activeTab, setActiveTab] = useState("all-by-all");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-label="Pooled-AF3 logo">
                <circle cx="8" cy="8" r="3" stroke="white" strokeWidth="2" />
                <circle cx="16" cy="8" r="3" stroke="white" strokeWidth="2" />
                <circle cx="12" cy="16" r="3" stroke="white" strokeWidth="2" />
                <line x1="10.5" y1="9" x2="12" y2="14" stroke="white" strokeWidth="1.5" />
                <line x1="13.5" y1="9" x2="12" y2="14" stroke="white" strokeWidth="1.5" />
                <line x1="11" y1="8" x2="13" y2="8" stroke="white" strokeWidth="1.5" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-foreground" data-testid="app-title">
                Pooled-AF3
              </h1>
              <p className="text-xs text-muted-foreground">
                Protein-Protein Interaction Screen Designer
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Based on Todor, Gross et al. 2025
            </span>
            <a
              href="https://github.com/horiatodor/pooled-af3"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              data-testid="link-github"
            >
              <Github size={16} />
            </a>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-5">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full max-w-lg grid-cols-3 mb-5">
            <TabsTrigger value="all-by-all" className="flex items-center gap-2" data-testid="tab-all-by-all">
              <FlaskConical size={14} />
              All-by-All Screen
            </TabsTrigger>
            <TabsTrigger value="one-by-all" className="flex items-center gap-2" data-testid="tab-one-by-all">
              <Globe size={14} />
              One-by-All Screen
            </TabsTrigger>
            <TabsTrigger value="upload-analyze" className="flex items-center gap-2" data-testid="tab-upload-analyze">
              <Upload size={14} />
              Upload &amp; Analyze
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all-by-all">
            <AllByAllScreen />
          </TabsContent>

          <TabsContent value="one-by-all">
            <ProteomeWideScreen />
          </TabsContent>

          <TabsContent value="upload-analyze">
            <UploadAnalyzeScreen />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
