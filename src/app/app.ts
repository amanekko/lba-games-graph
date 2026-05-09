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

  // Modal State
  public isEditModalOpen = signal(false);
  public editingNodeLabel = signal('');
  public editingNodeType = signal('standard');
  private editCallback: any = null;
  private editingNodeData: any = null;

  ngAfterViewInit(): void {
    this.loadExample();
  }

  private saveHistory(): void {
    try {
      const cleanNodes = this.nodes.get().map((node: any) => ({
        id: node.id,
        label: node.label,
        color: node.color,
        font: node.font,
        shape: node.shape,
        x: node.x,
        y: node.y,
        nodeType: node.nodeType
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
  }

  public updateLabel(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.editingNodeLabel.set(input.value);
  }

  public confirmEdit(): void {
    if (this.editCallback && this.editingNodeData) {
      const newLabel = this.editingNodeLabel();
      const newType = this.editingNodeType();
      
      const style = this.getNodeStyle(newType, newLabel);
      
      this.editingNodeData.label = style.label;
      this.editingNodeData.shape = style.shape;
      this.editingNodeData.color = style.color;
      this.editingNodeData.font = style.font;
      this.editingNodeData.nodeType = newType;

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

  private closeModal(): void {
    this.isEditModalOpen.set(false);
    this.editCallback = null;
    this.editingNodeData = null;
  }



  public loadExample(): void {
    this.errorMessage.set('');
    fetch('example-graph.json')
      .then(res => {
        if (!res.ok) throw new Error('Could not load example graph.');
        return res.json();
      })
      .then(data => {
        this.nodes.clear();
        this.edges.clear();
        this.nodes.add(data.nodes || []);
        this.edges.add(data.edges || []);
        this.renderGraph();
      })
      .catch(err => this.errorMessage.set(err.message));
  }

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        this.nodes.clear();
        this.edges.clear();
        this.nodes.add(data.nodes || []);
        this.edges.add(data.edges || []);

        this.renderGraph();
        this.errorMessage.set('');
      } catch (err) {
        this.errorMessage.set('Invalid JSON file format.');
      }
    };

    reader.onerror = () => this.errorMessage.set('Error reading the file.');
    reader.readAsText(file);
    input.value = '';
  }

  public exportJson(): void {
    // Extract only necessary data to keep JSON clean
    const cleanNodes = this.nodes.get().map((node: any) => {
      return {
        id: node.id,
        label: node.label,
        color: node.color,
        font: node.font,
        shape: node.shape,
        nodeType: node.nodeType
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

    const exportData = {
      nodes: cleanNodes,
      edges: cleanEdges
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "game-flow.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  }

  private getNodeStyle(type: string, label: string) {
    switch (type) {
      case 'and':
        return { label: label || 'AND', shape: 'circle', color: '#eab308', font: { color: '#ffffff' } };
      case 'or':
        return { label: label || 'OR', shape: 'circle', color: '#f97316', font: { color: '#ffffff' } };
      case 'start':
        return { label: label || 'Start', shape: 'box', color: '#10b981', font: { color: '#ffffff' } };
      case 'end':
        return { label: label || 'End', shape: 'box', color: '#ef4444', font: { color: '#ffffff' } };
      default:
        return { label: label || 'New Node', shape: 'box', color: '#3b82f6', font: { color: '#ffffff' } };
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
          this.editingNodeLabel.set(nodeData.label || '');
          this.editingNodeType.set(nodeData.nodeType || 'standard');
          this.isEditModalOpen.set(true);
        },
        addEdge: (edgeData: any, callback: any) => {
          if (edgeData.from === edgeData.to) {
            callback(null); // Optional: prevents self-loops
            return;
          }
          const label = prompt("Enter Edge Label (optional):");
          if (label === null) {
            callback(null);
            return;
          }
          this.saveHistory();
          edgeData.label = label || "";
          callback(edgeData);
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
  }
}
