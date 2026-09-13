import { Component, ElementRef, ViewChild, AfterViewInit, signal, HostListener, ChangeDetectorRef, NgZone } from '@angular/core';
import { Network, Options } from 'vis-network';
import { DataSet } from 'vis-data';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  standalone: true,
  imports: [FormsModule, CommonModule]
})
export class App implements AfterViewInit {
  @ViewChild('networkContainer') networkContainer!: ElementRef;

  public errorMessage = signal<string>('');
  public network: Network | null = null;

  // DataSets for vis-network
  private nodes = new DataSet<any>();
  private edges = new DataSet<any>();

  // History for undo feature
  private history: Array<{ nodes: any[], edges: any[] }> = [];

  // Modal State (Nodes)
  public isEditModalOpen = signal(false);
  public editingNodeLabel = signal('');
  public editingNodeType = signal('standard');
  public editingNodeMagicLevel = signal('0');
  public editingNodeIsland = signal('');
  private editCallback: any = null;
  private editingNodeData: any = null;

  // Island color palette
  private readonly ISLAND_PALETTE = [
    '#f59e0b', '#06b6d4', '#a855f7', '#f43f5e',
    '#14b8a6', '#fb923c', '#818cf8', '#84cc16'
  ];
  private islandColorMap = new Map<string, string>();
  // Current selected game (LBA1 or LBA2)
  public selectedGame: string = '';
  // Island sets per game
  private readonly GAME_ISLANDS: { [key: string]: string[] } = {
    LBA1: [
      'Citadel', 'Principal', 'White Leaf Desert',
      'Proxima', 'Hamalayi', 'Tipett', 'Brundle', 'Fortress', 'Polar'
    ],
    LBA2: [
      'Citadel island', 'Desert island', 'Moon base', 'Otringal',
      'Celebration island', 'Franco island', 'Elevator island',
      'Island CX', 'Wanny island', 'Mosquibee island'
    ]
  };
  // Islands currently in use (derived from selected game)
  public ISLANDS: string[] = this.GAME_ISLANDS[this.selectedGame];
  // Store copied nodes for copy‑paste functionality
  private copiedNodes: { nodes: any[]; edges: any[] } | null = null;
  // Simple ID generator for new nodes
  private generateNodeId(): number {
    // Convert existing node IDs to numbers, ignoring non-numeric IDs
    const numericIds = this.nodes.get().map((node: any) => {
      const idNum = Number(node.id);
      return isNaN(idNum) ? null : idNum;
    }).filter((id) => id !== null) as number[];
    return numericIds.length ? Math.max(...numericIds) + 1 : 1;
  }

  // Modal State (Edges)
  public isEdgeModalOpen = signal(false);
  public editingEdgeLabel = signal('');
  private editingEdgeId: string | null = null;
  private editEdgeCallback: any = null;
  private editingEdgeData: any = null;

  // File System handle for direct saving
  private fileHandle: any = null;
  public saveStatus = signal('');
  public isAutoLayout = signal(true);

  // Track where mousedown started to avoid accidental modal close
  private mouseDownOnBackdrop = false;

  constructor(private cdr: ChangeDetectorRef, private ngZone: NgZone) {}

  ngAfterViewInit(): void {
    this.errorMessage.set('');
    fetch('graph.json')
      .then(res => {
        if (!res.ok) throw new Error('Could not load graph.json.');
        return res.json();
      })
      .then(data => {
        this.nodes.clear();
        this.edges.clear();
        this.nodes.add(data.nodes || []);
        this.edges.add(data.edges || []);
        this.renderGraph();
      })
      .catch(() => this.renderGraph()); // Start empty if file not found
  }

  private saveHistory(): void {
    try {
      const cleanNodes = this.nodes.get().map((node: any) => ({
        id: node.id,
        label: node.label,
        baseLabel: node.baseLabel,
        color: node.color,
        font: node.font,
        shape: node.shape,
        x: node.x,
        y: node.y,
        nodeType: node.nodeType,
        magicLevel: node.magicLevel,
        island: node.island
      }));

      const cleanEdges = this.edges.get().map((edge: any) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label: edge.label
      }));

      const currentState = {
        nodes: JSON.parse(JSON.stringify(cleanNodes)),
        edges: JSON.parse(JSON.stringify(cleanEdges))
      };

      this.history.push(currentState);
      if (this.history.length > 50) {
        this.history.shift();
      }
    } catch (err) {
      console.error("History save failed:", err);
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Check for Ctrl+Z or Cmd+Z
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      this.undo();
      event.preventDefault();
      return;
    }

    // Check for Ctrl+S or Cmd+S
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      this.saveGraph();
      event.preventDefault();
      return;
    }

    // Check for Delete or Backspace
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // Make sure we are not in an input field
      const target = event.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
        if (this.network) {
          this.network.deleteSelected();
          event.preventDefault();
        }
      }
    }

    // Check for '+'
    if (event.key === '+') {
      const target = event.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
        if (this.network) {
          this.network.addNodeMode();
          event.preventDefault();
        }
      }
    }

    // Check for 'L' (Link)
    if (event.key.toLowerCase() === 'l') {
      const target = event.target as HTMLElement;
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && target.tagName !== 'SELECT') {
        if (this.network) {
          const selectedNodes = this.network.getSelectedNodes();
          if (selectedNodes.length >= 2) {
            this.saveHistory();
            // Connect nodes in sequence: 1 -> 2 -> 3...
            for (let i = 0; i < selectedNodes.length - 1; i++) {
              this.edges.add({
                from: selectedNodes[i],
                to: selectedNodes[i + 1],
                label: ''
              });
            }
            this.network.unselectAll();
            event.preventDefault();
          }
        }
      }
    }
    // Copy selected nodes (Ctrl+C / Cmd+C)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      this.copySelectedNodes();
      event.preventDefault();
      return;
    }
    // Paste nodes (Ctrl+V / Cmd+V)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      this.pasteNodes();
      event.preventDefault();
      return;
    }
  }

  public undo(): void {
    if (this.history.length === 0) return;
    const previousState = this.history.pop();
    if (previousState) {
      this.nodes.clear();
      this.edges.clear();
      this.nodes.add(previousState.nodes);
      this.edges.add(previousState.edges);
    }
  }

  public setNodeType(type: string): void {
    this.editingNodeType.set(type);
    if (type === 'start') this.editingNodeLabel.set('Start');
    if (type === 'end') this.editingNodeLabel.set('End');
    if (type === 'and') this.editingNodeLabel.set('AND');
    if (type === 'or') this.editingNodeLabel.set('OR');
    if (type === 'chapter' && !this.editingNodeLabel().startsWith('Chapter')) this.editingNodeLabel.set('Chapter ');
  }

  public updateLabel(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.editingNodeLabel.set(input.value);
  }

  public confirmEdit(): void {
    if (this.editCallback && this.editingNodeData) {
      const baseLabel = this.editingNodeLabel();
      const newType = this.editingNodeType();
      const magicLevel = this.editingNodeMagicLevel();
      const island = this.editingNodeIsland().trim();

      const style = this.getNodeStyle(newType, baseLabel, magicLevel);

      this.editingNodeData.label = style.label;
      this.editingNodeData.shape = style.shape;
      this.editingNodeData.color = style.color;
      this.editingNodeData.font = style.font;
      this.editingNodeData.nodeType = newType;
      this.editingNodeData.baseLabel = baseLabel;
      this.editingNodeData.magicLevel = newType === 'enemy' ? magicLevel : undefined;
      this.editingNodeData.island = island || undefined;
      this.editingNodeData.borderWidth = 2;
      this.editingNodeData.shapeProperties = { borderDashes: false };

      this.saveHistory();
      this.editCallback(this.editingNodeData);
    }
    this.closeModal();
  }

  public cancelEdit(): void {
    if (this.editCallback) {
      this.editCallback(null);
    }
    this.closeModal();
  }

  public onBackdropMouseDown(event: MouseEvent): void {
    this.mouseDownOnBackdrop = event.target === event.currentTarget;
  }

  public onBackdropClick(cancel: () => void): void {
    if (this.mouseDownOnBackdrop) {
      cancel();
    }
    this.mouseDownOnBackdrop = false;
  }

  private closeModal(): void {
    this.isEditModalOpen.set(false);
    this.editCallback = null;
    this.editingNodeData = null;
  }

  public updateEdgeLabel(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.editingEdgeLabel.set(input.value);
  }

  public confirmEdgeEdit(): void {
    if (this.editEdgeCallback && this.editingEdgeData) {
      this.editingEdgeData.label = this.editingEdgeLabel();
      this.saveHistory();
      this.editEdgeCallback(this.editingEdgeData);
    } else if (this.editingEdgeId) {
      this.saveHistory();
      this.edges.update({ id: this.editingEdgeId, label: this.editingEdgeLabel() });
    }
    this.closeEdgeModal();
  }

  public cancelEdgeEdit(): void {
    if (this.editEdgeCallback) {
      this.editEdgeCallback(null);
    }
    this.closeEdgeModal();
  }

  private closeEdgeModal(): void {
    this.isEdgeModalOpen.set(false);
    this.editingEdgeId = null;
    this.editEdgeCallback = null;
    this.editingEdgeData = null;
  }

  // Handles change of selected game
  public onGameChange(game: string): void {
    this.selectedGame = game;
    // Update islands list for new game
    this.ISLANDS = this.GAME_ISLANDS[game] || [];
    // Reset island color map to reflect new islands
    this.islandColorMap.clear();
  }

  public async openFile(): Promise<void> {
    // Try File System Access API (Chrome/Edge)
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
        });
        this.fileHandle = handle;
        const file = await handle.getFile();
        const text = await file.text();
        this.loadGraphData(text);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
      }
    }
    // Fallback: trigger hidden file input
    document.getElementById('fallbackFileInput')?.click();
  }

  private loadGraphData(text: string): void {
    try {
      const data = JSON.parse(text);
      this.nodes.clear();
      this.edges.clear();
      this.nodes.add(data.nodes || []);
      this.edges.add(data.edges || []);
      // Update selected game if provided in the file
      if (data.game && typeof data.game === 'string') {
        // Run inside Angular zone to ensure view updates
        this.ngZone.run(() => {
          this.selectedGame = data.game;
          this.onGameChange(data.game);
        });
      }
      this.renderGraph();
      // Ensure Angular updates bound UI (dropdown, island list)
      this.cdr.detectChanges();
      this.errorMessage.set('');
    } catch {
      this.errorMessage.set('Invalid JSON file format.');
    }
  }

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const reader = new FileReader();
    reader.onload = (e) => this.loadGraphData(e.target?.result as string);
    reader.onerror = () => this.errorMessage.set('Error reading the file.');
    reader.readAsText(input.files[0]);
    input.value = '';
  }

  public async saveGraph(): Promise<void> {
    const data = this.buildExportData();
    const json = JSON.stringify(data, null, 2);

    // Try File System Access API (Chrome/Edge)
    if ('showSaveFilePicker' in window) {
      try {
        if (!this.fileHandle) {
          this.fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: 'graph.json',
            types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
          });
        }
        const writable = await this.fileHandle.createWritable();
        await writable.write(json);
        await writable.close();
        this.saveStatus.set('Saved!');
        setTimeout(() => this.saveStatus.set(''), 2000);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return; // User cancelled
        this.fileHandle = null; // Reset on error
      }
    }

    // Fallback: download as graph.json
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'graph.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  public toggleAutoLayout(): void {
    this.isAutoLayout.update(val => !val);
    this.renderGraph();
  }

  private buildExportData() {
    const positions = this.network ? this.network.getPositions() : {};
    const cleanNodes = this.nodes.get().map((node: any) => {
      const pos = positions[node.id] || { x: node.x, y: node.y };
      return {
        id: node.id,
        label: node.label,
        baseLabel: node.baseLabel,
        color: node.color,
        font: node.font,
        shape: node.shape,
        nodeType: node.nodeType,
        magicLevel: node.magicLevel,
        island: node.island,
        borderWidth: node.borderWidth,
        shapeProperties: node.shapeProperties,
        x: pos.x,
        y: pos.y
      };
    });

    const cleanEdges = this.edges.get().map((edge: any) => {
      return {
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label: edge.label
      };
    });

    return { game: this.selectedGame, nodes: cleanNodes, edges: cleanEdges };
  }

  public getIslands(): { name: string; color: string }[] {
    const seen = new Set<string>();
    const result: { name: string; color: string }[] = [];
    this.nodes.get().forEach((node: any) => {
      if (node.island && !seen.has(node.island)) {
        seen.add(node.island);
        result.push({ name: node.island, color: this.getIslandColor(node.island) });
      }
    });
    return result;
  }

  private getIslandColor(name: string): string {
    if (!this.islandColorMap.has(name)) {
      const idx = this.islandColorMap.size % this.ISLAND_PALETTE.length;
      this.islandColorMap.set(name, this.ISLAND_PALETTE[idx]);
    }
    return this.islandColorMap.get(name)!;
  }

  public exportJson(): void {
    const data = this.buildExportData();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "graph.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  // Handle export dropdown change
  public onExportChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select?.value;
    if (value === 'json') {
      this.exportJson();
    } else if (value === 'html') {
      this.exportHtml();
    }
  }
    // Copy selected nodes to internal clipboard
  private copySelectedNodes(): void {
    if (!this.network) return;
    const selectedIds = this.network.getSelectedNodes();
    if (selectedIds.length === 0) {
      this.copiedNodes = null;
      return;
    }
    const selectedNodes = this.nodes.get(selectedIds);
    const selectedIdSet = new Set(selectedIds);
    const selectedEdges = this.edges.get().filter((e: any) => selectedIdSet.has(e.from) && selectedIdSet.has(e.to));
    this.copiedNodes = { nodes: selectedNodes, edges: selectedEdges };
  }

  // Paste previously copied nodes, offsetting positions
  private pasteNodes(): void {
    if (!this.network || !this.copiedNodes) return;
    const idMap = new Map<number, number>();
    this.copiedNodes.nodes.forEach((node: any) => {
      const newId = this.generateNodeId();
      idMap.set(node.id, newId);
      const newNode = { ...node, id: newId };
      if (newNode.x !== undefined) newNode.x += 30;
      if (newNode.y !== undefined) newNode.y += 30;
      this.nodes.add(newNode);
    });
    this.copiedNodes.edges.forEach((edge: any) => {
      const newFrom = idMap.get(edge.from);
      const newTo = idMap.get(edge.to);
      if (newFrom !== undefined && newTo !== undefined) {
        const newEdge = { ...edge, from: newFrom, to: newTo };
        this.edges.add(newEdge);
      }
    });
    this.saveHistory();
    const newIds = Array.from(idMap.values());
    this.network.selectNodes(newIds);
  }

  public exportHtml(): void {
    const exportData = this.buildExportData();
    const islands = this.getIslands();

    // Create legend items HTML
    const legendHtml = islands.map(isl => `
      <div class="legend-item">
        <span class="legend-dot" style="background: ${isl.color}; border-color: ${isl.color}"></span>
        <span class="legend-label">${isl.name}</span>
      </div>
    `).join('');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Game Flow Export - Snapshot</title>
  <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-color: #0f172a;
      --panel-bg: rgba(30, 41, 59, 0.7);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --accent-color: #3b82f6;
      --border-color: rgba(255, 255, 255, 0.1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg-color);
      color: var(--text-primary);
      overflow: hidden;
      height: 100vh;
      width: 100vw;
      background: radial-gradient(circle at 50% -20%, #1e293b, #0f172a 80%);
    }
    .app-container { display: flex; flex-direction: column; height: 100vh; padding: 20px; gap: 20px; }
    .glass-panel {
      background: var(--panel-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);
    }
    .canvas-container { flex: 1; border-radius: 12px; overflow: hidden; position: relative; min-height: 500px; }
    .network-wrapper { width: 100%; height: 100%; position: absolute; top: 0; left: 0; }
    .island-legend {
      position: absolute; bottom: 16px; left: 16px; z-index: 10;
      padding: 12px 16px; display: flex; flex-direction: column; gap: 8px;
      min-width: 160px; pointer-events: none;
    }
    .legend-title {
      font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--text-secondary); margin: 0 0 4px 0;
    }
    .legend-item { display: flex; align-items: center; gap: 8px; }
    .legend-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid; flex-shrink: 0; }
    .legend-label { font-size: 0.85rem; color: var(--text-primary); }
  </style>
</head>
<body>
  <div class="app-container">
    <main class="canvas-container glass-panel">
      <div id="networkContainer" class="network-wrapper"></div>
      ${islands.length > 0 ? `
      <div class="island-legend glass-panel">
        <p class="legend-title">Islands</p>
        ${legendHtml}
      </div>` : ''}
    </main>
  </div>

  <script>
    const data = ${JSON.stringify(exportData)};
    const ISLAND_PALETTE = ${JSON.stringify(this.ISLAND_PALETTE)};
    const islandColorMap = new Map();

    function getIslandColor(name) {
      if (!islandColorMap.has(name)) {
        const idx = islandColorMap.size % ISLAND_PALETTE.length;
        islandColorMap.set(name, ISLAND_PALETTE[idx]);
      }
      return islandColorMap.get(name);
    }

    const container = document.getElementById('networkContainer');
    const options = {
      nodes: {
        shape: 'box',
        margin: { top: 10, bottom: 10, left: 10, right: 10 },
        font: { size: 16, face: 'Inter, sans-serif' },
        shadow: true,
        borderWidth: 2
      },
      edges: {
        arrows: { to: { enabled: true, scaleFactor: 1, type: 'arrow' } },
        color: { color: '#94a3b8', highlight: '#f8fafc', hover: '#cbd5e1' },
        font: { size: 12, face: 'Inter, sans-serif', color: '#cbd5e1', strokeWidth: 2, strokeColor: '#0f172a' },
        smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.5 }
      },
      interaction: { hover: true, tooltipDelay: 200 },
      physics: { enabled: false }
    };

    const network = new vis.Network(container, data, options);

    const crossProduct = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const getHull = (points) => {
      if (points.length <= 2) return points;
      points.sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
      const upper = [];
      for (const p of points) {
        while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      const lower = [];
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }
      upper.pop();
      lower.pop();
      return upper.concat(lower);
    };

    network.on('beforeDrawing', (ctx) => {
      const nodesByIsland = new Map();
      data.nodes.forEach(node => {
        if (node.island) {
          if (!nodesByIsland.has(node.island)) nodesByIsland.set(node.island, []);
          nodesByIsland.get(node.island).push(node);
        }
      });

      nodesByIsland.forEach((nodes, islandName) => {
        const visited = new Set();
        const clusters = [];
        nodes.forEach(startNode => {
          if (!visited.has(startNode.id)) {
            const cluster = [];
            const queue = [startNode];
            visited.add(startNode.id);
            while (queue.length > 0) {
              const current = queue.shift();
              cluster.push(current);
              data.edges.forEach(edge => {
                let neighborId = null;
                if (edge.from === current.id) neighborId = edge.to;
                else if (edge.to === current.id) neighborId = edge.from;
                if (neighborId) {
                  const neighborNode = nodes.find(n => n.id === neighborId);
                  if (neighborNode && !visited.has(neighborId)) {
                    visited.add(neighborId);
                    queue.push(neighborNode);
                  }
                }
              });
            }
            clusters.push(cluster);
          }
        });

        clusters.forEach(clusterNodes => {
          const color = getIslandColor(islandName);
          const points = [];
          clusterNodes.forEach(node => {
            const bb = network.getBoundingBox(node.id);
            if (bb) {
              points.push({ x: bb.left, y: bb.top }, { x: bb.right, y: bb.top },
                          { x: bb.left, y: bb.bottom }, { x: bb.right, y: bb.bottom });
            }
          });
          if (points.length === 0) return;
          const hull = getHull(points);
          const pad = 20;
          ctx.save();
          ctx.beginPath();
          if (hull.length > 0) {
            ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = pad * 2;
            ctx.moveTo(hull[0].x, hull[0].y);
            for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
            ctx.closePath();
            ctx.fillStyle = color + '1a'; ctx.strokeStyle = color + '33';
            ctx.fill(); ctx.stroke();
            ctx.strokeStyle = color; ctx.setLineDash([8, 5]); ctx.lineWidth = 2; ctx.stroke();
            let topMost = hull[0];
            hull.forEach(p => { if (p.y < topMost.y || (p.y === topMost.y && p.x < topMost.x)) topMost = p; });
            ctx.setLineDash([]); ctx.font = 'bold 12px Inter, sans-serif'; ctx.fillStyle = color;
            ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
            ctx.fillText(islandName, topMost.x, topMost.y - pad - 4);
          }
          ctx.restore();
        });
      });
    });
  </script>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'graph_export.html';
    a.click();
    URL.revokeObjectURL(url);
  }

  private getNodeStyle(type: string, baseLabel: string, magicLevel: string = '0') {
    const magic = type === 'enemy' ? `\n[Magic: ${magicLevel}]` : '';
    switch (type) {
      case 'enemy':
        return { label: (baseLabel || 'Enemy') + magic, shape: 'box', color: '#ef4444', font: { color: '#ffffff' } };
      case 'object':
        return { label: baseLabel || 'Object', shape: 'box', color: '#ca8a04', font: { color: '#ffffff' } };
      case 'scene':
        return { label: baseLabel || 'Scene', shape: 'box', color: '#10b981', font: { color: '#ffffff' } };
      case 'and':
        return { label: baseLabel || 'AND', shape: 'ellipse', color: '#7c3aed', font: { color: '#ffffff' } };
      case 'or':
        return { label: baseLabel || 'OR', shape: 'ellipse', color: '#7c3aed', font: { color: '#ffffff' } };
      case 'start':
        return { label: baseLabel || 'Start', shape: 'box', color: '#64748b', font: { color: '#ffffff' } };
      case 'end':
        return { label: baseLabel || 'End', shape: 'box', color: '#64748b', font: { color: '#ffffff' } };
      case 'chapter':
        return { label: baseLabel || 'Chapter', shape: 'box', color: '#db2777', font: { color: '#ffffff', size: 18, face: 'Inter, sans-serif' }, borderWidth: 3 };
      default: // standard
        return { label: baseLabel || 'Node', shape: 'box', color: '#3b82f6', font: { color: '#ffffff' } };
    }
  }

  private renderGraph(): void {
    const container = this.networkContainer.nativeElement;

    const data = {
      nodes: this.nodes,
      edges: this.edges
    };

    const options: Options = {
      nodes: {
        shape: 'box',
        margin: { top: 10, bottom: 10, left: 10, right: 10 },
        font: { size: 16, face: 'Inter, sans-serif' },
        shadow: true,
        borderWidth: 2
      },
      edges: {
        arrows: { to: { enabled: true, scaleFactor: 1, type: 'arrow' } },
        color: { color: '#94a3b8', highlight: '#f8fafc', hover: '#cbd5e1' },
        font: { size: 12, face: 'Inter, sans-serif', color: '#cbd5e1', strokeWidth: 2, strokeColor: '#0f172a' },
        smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.5 }
      },
      layout: {
        hierarchical: {
          enabled: this.isAutoLayout(),
          direction: 'LR',
          sortMethod: 'directed',
          nodeSpacing: 200,
          levelSeparation: 250,
          parentCentralization: true,
          edgeMinimization: true,
          blockShifting: true
        }
      },
      physics: {
        enabled: false,
        hierarchicalRepulsion: { nodeDistance: 150 }
      },
      manipulation: {
        enabled: true,
        addNode: (nodeData: any, callback: any) => {
          const finalLabel = `Node ${this.nodes.length + 1}`;
          const style = this.getNodeStyle('standard', finalLabel);

          nodeData.label = style.label;
          nodeData.shape = style.shape;
          nodeData.color = style.color;
          nodeData.font = style.font;
          nodeData.nodeType = 'standard';

          this.saveHistory();
          callback(nodeData);
        },
        editNode: (nodeData: any, callback: any) => {
          this.editingNodeData = nodeData;
          this.editCallback = callback;
          this.editingNodeLabel.set(nodeData.baseLabel || nodeData.label || '');
          this.editingNodeType.set(nodeData.nodeType || 'standard');
          this.editingNodeMagicLevel.set(nodeData.magicLevel || '0');
          this.editingNodeIsland.set(nodeData.island || '');
          this.isEditModalOpen.set(true);
        },
        addEdge: (edgeData: any, callback: any) => {
          if (edgeData.from === edgeData.to) {
            callback(null); // Optional: prevents self-loops
            return;
          }
          this.editingEdgeData = edgeData;
          this.editEdgeCallback = callback;
          this.editingEdgeLabel.set('');
          this.isEdgeModalOpen.set(true);
        },
        editEdge: false,
        deleteNode: (nodeData: any, callback: any) => {
          this.saveHistory();
          callback(nodeData);
        },
        deleteEdge: (edgeData: any, callback: any) => {
          this.saveHistory();
          callback(edgeData);
        }
      },
      interaction: {
        hover: true,
        tooltipDelay: 200,
        multiselect: true,
        selectConnectedEdges: false
      }
    };

    if (this.network) {
      this.network.destroy();
    }

    this.network = new Network(container, data, options);

    // Math helper for convex hull
    const crossProduct = (a: any, b: any, c: any) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const getHull = (points: any[]) => {
      if (points.length <= 2) return points;
      points.sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);
      const upper = [];
      for (const p of points) {
        while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
      }
      const lower = [];
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
      }
      upper.pop();
      lower.pop();
      return upper.concat(lower);
    };

    // Draw island background envelopes before nodes are rendered
    this.network.on('beforeDrawing', (ctx: CanvasRenderingContext2D) => {
      const nodesByIsland = new Map<string, any[]>();
      this.nodes.get().forEach((node: any) => {
        if (node.island) {
          if (!nodesByIsland.has(node.island)) nodesByIsland.set(node.island, []);
          nodesByIsland.get(node.island)!.push(node);
        }
      });

      const edges = this.edges.get();

      nodesByIsland.forEach((nodes, islandName) => {
        const visited = new Set<string>();
        const clusters: any[][] = [];

        nodes.forEach(startNode => {
          if (!visited.has(startNode.id)) {
            const cluster: any[] = [];
            const queue = [startNode];
            visited.add(startNode.id);
            while (queue.length > 0) {
              const current = queue.shift()!;
              cluster.push(current);
              edges.forEach((edge: any) => {
                let neighborId = null;
                if (edge.from === current.id) neighborId = edge.to;
                else if (edge.to === current.id) neighborId = edge.from;
                if (neighborId) {
                  const neighborNode = nodes.find(n => n.id === neighborId);
                  if (neighborNode && !visited.has(neighborId)) {
                    visited.add(neighborId);
                    queue.push(neighborNode);
                  }
                }
              });
            }
            clusters.push(cluster);
          }
        });

        clusters.forEach(clusterNodes => {
          const color = this.getIslandColor(islandName);
          const points: any[] = [];
          clusterNodes.forEach(node => {
            const bb = this.network!.getBoundingBox(node.id);
            if (bb) {
              // Add corners of the node to the point set for the hull
              points.push({ x: bb.left, y: bb.top });
              points.push({ x: bb.right, y: bb.top });
              points.push({ x: bb.left, y: bb.bottom });
              points.push({ x: bb.right, y: bb.bottom });
            }
          });

          if (points.length === 0) return;

          const hull = getHull(points);
          const pad = 20;

          ctx.save();
          ctx.beginPath();

          if (hull.length > 0) {
            // Draw a path around the hull points with rounded expansion
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.lineWidth = pad * 2;

            ctx.moveTo(hull[0].x, hull[0].y);
            for (let i = 1; i < hull.length; i++) {
              ctx.lineTo(hull[i].x, hull[i].y);
            }
            ctx.closePath();

            // Fill and Stroke the expanded hull
            // We use a thick stroke to create the padding effect
            ctx.fillStyle = color + '1a';
            ctx.strokeStyle = color + '33'; // Faint stroke for the "aura"
            ctx.fill();
            ctx.stroke();

            // Draw the dashed border separately to avoid internal lines
            ctx.strokeStyle = color;
            ctx.setLineDash([8, 5]);
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label position: top-left-most point
            let topMost = hull[0];
            hull.forEach(p => { if (p.y < topMost.y || (p.y === topMost.y && p.x < topMost.x)) topMost = p; });

            ctx.setLineDash([]);
            ctx.font = 'bold 12px Inter, sans-serif';
            ctx.fillStyle = color;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(islandName, topMost.x, topMost.y - pad - 4);
          }
          ctx.restore();
        });
      });
    });

    // Track the last selected node for Ctrl+Click connections
    let lastSelectedNode: string | null = null;

    this.network.on('click', (params) => {
      const ctrlPressed = params.event.srcEvent.ctrlKey || params.event.srcEvent.metaKey;
      const clickedNode = params.nodes.length > 0 ? params.nodes[0] : null;

      if (ctrlPressed && lastSelectedNode !== null && clickedNode !== null && lastSelectedNode !== clickedNode) {
        // Create an edge from the last selected node to the newly clicked node
        this.saveHistory();
        this.edges.add({
          from: lastSelectedNode,
          to: clickedNode,
          label: ''
        });
      } else if (!ctrlPressed) {
        // Update the last selected node only if Ctrl is not pressed
        lastSelectedNode = clickedNode;
      }
    });

    this.network.on('doubleClick', (params) => {
      if (params.nodes.length > 0) {
        // Vis-network's built-in edit mode triggers our custom editNode callback
        this.network?.editNode();
      } else if (params.edges.length > 0) {
        // Handle edge label editing via custom modal
        const edgeId = params.edges[0];
        const edgeData = this.edges.get(edgeId) as any;
        if (edgeData) {
          this.editingEdgeId = edgeId;
          this.editingEdgeLabel.set(edgeData.label || "");
          this.isEdgeModalOpen.set(true);
        }
      }
    });
  }
}
