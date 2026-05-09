import { Component, ElementRef, ViewChild, AfterViewInit, signal, HostListener } from '@angular/core';
import { Network, Options } from 'vis-network';
import { DataSet } from 'vis-data';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements AfterViewInit {
  @ViewChild('networkContainer') networkContainer!: ElementRef;

  public errorMessage = signal<string>('');
  private network: Network | null = null;

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

  // Modal State (Edges)
  public isEdgeModalOpen = signal(false);
  public editingEdgeLabel = signal('');
  private editingEdgeId: string | null = null;
  private editEdgeCallback: any = null;
  private editingEdgeData: any = null;

  // File System handle for direct saving
  private fileHandle: any = null;
  public saveStatus = signal('');

  // Track where mousedown started to avoid accidental modal close
  private mouseDownOnBackdrop = false;

  public readonly ISLANDS = [
    'Citadel', 'Principal', 'White Leaf Desert',
    'Proxima', 'Hamalyi', 'Tipett', 'Brundle', 'Fortress', 'Polar'
  ];

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
      this.renderGraph();
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

  private buildExportData() {
    const cleanNodes = this.nodes.get().map((node: any) => {
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
        shapeProperties: node.shapeProperties
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

    return { nodes: cleanNodes, edges: cleanEdges };
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
        smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.4 }
      },
      layout: {
        hierarchical: { direction: 'LR', sortMethod: 'directed', nodeSpacing: 150, levelSeparation: 200 }
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
      physics: {
        hierarchicalRepulsion: { nodeDistance: 150 }
      },
      interaction: { hover: true, tooltipDelay: 200 }
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
