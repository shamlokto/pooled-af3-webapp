# Pooled-AF3 Web App — QA & Deployment Summary

## Deployment
- **URL**: Deployed via `deploy_website` from `/home/user/workspace/pooled-af3/dist/public`
- **Production server**: Running on port 5000 via `NODE_ENV=production node dist/index.cjs`
- **Build output**: 5 files (index.html, JS bundle, CSS, JSZip chunk, gene_metadata.json)

## Visual QA Results

### Desktop (1400x900)
- **Header**: Pooled-AF3 logo + title + citation "Based on Todor, Gross et al. 2025" — renders correctly
- **Tab bar**: All-by-All Screen / Proteome-Wide Screen tabs working
- **Step indicator**: 4-step indicator (Select Proteins → Generate Pools → Upload Results → Analyze) — steps highlight correctly as workflow progresses
- **Protein selection table**: 73 D39W preset proteins with SPD Locus, Gene, Category (colored badges), Length columns — scrollable with sticky headers
- **Filters**: Category filter dropdown + search input working (tested "mur" filter — correct results)
- **Select All / Deselect All**: Working, count badge updates correctly
- **Pool generation**: 58 pools, 4073 pair tests, 519–4800 residues/pool — confirmed matching expected output
- **Pool results card**: Stats grid, scrollable pool table, download buttons (AF3 JSON Batches, Description CSV, Extract Script)
- **Upload section**: Upload Confidence Files button with instructions
- **Proteome-Wide tab**: Query protein selector + custom sequence input, Target Proteome loader (D39W 1,910), Generate button

### Mobile (375x812)
- Layout adapts well — single column, tab bar fits both tabs
- Protein table columns compress appropriately (Length column hidden)
- Step indicator wraps but remains legible
- All interactive controls accessible

### Backend API Verification
- `GET /api/proteins` — Returns 73 proteins with metadata + sequences ✓
- `POST /api/pools/generate` — All-by-all mode: 58 pools for 73 proteins ✓
- `GET /api/extract-script` — Returns shell script (666 bytes) ✓
- `GET /api/proteome-fasta` — Returns 1,910 proteins from full D39W proteome ✓
- `POST /api/parse-fasta` — FASTA parser working ✓

### Issues Found & Status
- No critical issues found
- Mobile step indicator wraps slightly — acceptable at 375px
- "Upload Custom FASTA" button text truncated on mobile — acceptable

## Git Status
- All changes committed to master branch
- Clean working tree
