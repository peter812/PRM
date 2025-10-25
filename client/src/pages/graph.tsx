import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Application, Graphics, Container, Text, TextStyle } from "pixi.js";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";
import type { Person, RelationshipWithPerson } from "@shared/schema";
import { AddConnectionDialog } from "@/components/add-connection-dialog";

interface PersonWithRelationships extends Person {
  relationships?: RelationshipWithPerson[];
}

interface Node {
  id: string;
  person: Person;
  x: number;
  y: number;
  vx: number;
  vy: number;
  graphics: Graphics;
  text: Text;
}

interface Edge {
  from: string;
  to: string;
  level: string;
  graphics: Graphics;
}

// Helper to convert HSL from CSS variable to hex color
function hslToHex(h: number, s: number, l: number): number {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color);
  };
  return (f(0) << 16) + (f(8) << 8) + f(4);
}

// Parse HSL string from CSS variable
function parseHSL(hslString: string): { h: number; s: number; l: number } {
  const values = hslString.split(' ').map(v => parseFloat(v));
  return { h: values[0], s: values[1], l: values[2] };
}

export default function Graph() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const edgesRef = useRef<Edge[]>([]);
  const containerRef = useRef<Container | null>(null);
  const animationRef = useRef<number>(0);
  const isDraggingRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [, navigate] = useLocation();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const { data: people = [] } = useQuery<PersonWithRelationships[]>({
    queryKey: ["/api/people?includeRelationships=true"],
  });

  const relationshipColors: Record<string, number> = {
    colleague: 0x3b82f6, // blue
    friend: 0x10b981, // green
    family: 0xef4444, // red
    client: 0xf59e0b, // amber
    partner: 0x8b5cf6, // purple
    mentor: 0x06b6d4, // cyan
    other: 0x6b7280, // gray
  };

  useEffect(() => {
    if (!canvasRef.current || !people.length) return;

    const initPixi = async () => {
      // Clean up existing app
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
      }

      // Get theme colors from CSS variables
      const styles = getComputedStyle(document.documentElement);
      const backgroundHSL = styles.getPropertyValue('--background').trim();
      const foregroundHSL = styles.getPropertyValue('--foreground').trim();
      
      const bgColor = parseHSL(backgroundHSL);
      const fgColor = parseHSL(foregroundHSL);
      
      const backgroundColor = hslToHex(bgColor.h, bgColor.s, bgColor.l);
      const foregroundColor = hslToHex(fgColor.h, fgColor.s, fgColor.l);
      const lineColor = foregroundColor; // Use foreground color for lines

      // Create PIXI application
      const app = new Application();
      await app.init({
        width: canvasRef.current?.clientWidth || 800,
        height: canvasRef.current?.clientHeight || 600,
        backgroundColor: backgroundColor,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (canvasRef.current) {
        canvasRef.current.appendChild(app.canvas);
      }
      appRef.current = app;

      // Create main container for zooming/panning
      const container = new Container();
      app.stage.addChild(container);
      containerRef.current = container;

      // Center point
      const centerX = app.screen.width / 2;
      const centerY = app.screen.height / 2;

      // Initialize nodes
      const nodes = new Map<string, Node>();
      const radius = Math.min(app.screen.width, app.screen.height) / 3;

      people.forEach((person, i) => {
        const angle = (i / people.length) * Math.PI * 2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;

        const graphics = new Graphics();
        graphics.circle(0, 0, 20);
        graphics.fill({ color: 0x6366f1 });
        graphics.stroke({ color: 0x818cf8, width: 2 });
        graphics.x = x;
        graphics.y = y;
        graphics.eventMode = 'static';
        graphics.cursor = 'grab';

        const textStyle = new TextStyle({
          fontFamily: 'Inter, sans-serif',
          fontSize: 12,
          fill: foregroundColor,
        });

        const text = new Text({
          text: `${person.firstName} ${person.lastName}`,
          style: textStyle,
        });
        text.anchor.set(0.5, -1.5);
        text.x = x;
        text.y = y;

        // Interaction handlers
        graphics.on('pointerdown', (e) => {
          isDraggingRef.current = person.id;
          dragStartRef.current = { x: e.global.x, y: e.global.y };
          graphics.cursor = 'grabbing';
          e.stopPropagation();
        });

        graphics.on('pointerup', (e) => {
          if (isDraggingRef.current === person.id && dragStartRef.current) {
            // Only navigate if drag distance is small (click vs drag)
            const dx = e.global.x - dragStartRef.current.x;
            const dy = e.global.y - dragStartRef.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 5) {
              navigate(`/person/${person.id}`);
            }
          }
          isDraggingRef.current = null;
          dragStartRef.current = null;
          graphics.cursor = 'grab';
        });

        graphics.on('pointerover', () => {
          graphics.clear();
          graphics.circle(0, 0, 24);
          graphics.fill({ color: 0x818cf8 });
          graphics.stroke({ color: 0xa5b4fc, width: 3 });
        });

        graphics.on('pointerout', () => {
          graphics.clear();
          graphics.circle(0, 0, 20);
          graphics.fill({ color: 0x6366f1 });
          graphics.stroke({ color: 0x818cf8, width: 2 });
        });

        container.addChild(graphics);
        container.addChild(text);

        nodes.set(person.id, {
          id: person.id,
          person,
          x,
          y,
          vx: 0,
          vy: 0,
          graphics,
          text,
        });
      });

      nodesRef.current = nodes;

      // Create edges
      const edges: Edge[] = [];
      people.forEach((person) => {
        if (person.relationships) {
          person.relationships.forEach((rel) => {
            const fromNode = nodes.get(person.id);
            const toNode = nodes.get(rel.toPersonId);

            if (fromNode && toNode) {
              const graphics = new Graphics();
              
              graphics.moveTo(fromNode.x, fromNode.y);
              graphics.lineTo(toNode.x, toNode.y);
              graphics.stroke({ color: lineColor, width: 2, alpha: 0.3 });

              container.addChildAt(graphics, 0); // Add edges behind nodes
              edges.push({
                from: person.id,
                to: rel.toPersonId,
                level: rel.level,
                graphics,
              });
            }
          });
        }
      });

      edgesRef.current = edges;

      // Physics simulation
      const simulate = () => {
        const nodes = Array.from(nodesRef.current.values());
        const damping = 0.9;
        const repulsion = 3000;
        const attraction = 0.01;
        const centerForce = 0.001;

        // Apply forces
        nodes.forEach((node) => {
          let fx = 0;
          let fy = 0;

          // Repulsion between nodes
          nodes.forEach((other) => {
            if (node.id !== other.id) {
              const dx = node.x - other.x;
              const dy = node.y - other.y;
              const distSq = dx * dx + dy * dy + 1;
              const force = repulsion / distSq;
              fx += (dx / Math.sqrt(distSq)) * force;
              fy += (dy / Math.sqrt(distSq)) * force;
            }
          });

          // Attraction along edges
          edgesRef.current.forEach((edge) => {
            let other: Node | undefined;
            if (edge.from === node.id) {
              other = nodesRef.current.get(edge.to);
            } else if (edge.to === node.id) {
              other = nodesRef.current.get(edge.from);
            }

            if (other) {
              const dx = other.x - node.x;
              const dy = other.y - node.y;
              fx += dx * attraction;
              fy += dy * attraction;
            }
          });

          // Center attraction
          const dx = centerX - node.x;
          const dy = centerY - node.y;
          fx += dx * centerForce;
          fy += dy * centerForce;

          node.vx = (node.vx + fx) * damping;
          node.vy = (node.vy + fy) * damping;
        });

        // Update positions (skip if dragging)
        nodes.forEach((node) => {
          if (isDraggingRef.current !== node.id) {
            node.x += node.vx;
            node.y += node.vy;
            node.graphics.x = node.x;
            node.graphics.y = node.y;
            node.text.x = node.x;
            node.text.y = node.y;
          }
        });

        // Update edge positions
        edgesRef.current.forEach((edge) => {
          const fromNode = nodesRef.current.get(edge.from);
          const toNode = nodesRef.current.get(edge.to);
          if (fromNode && toNode) {
            edge.graphics.clear();
            edge.graphics.moveTo(fromNode.x, fromNode.y);
            edge.graphics.lineTo(toNode.x, toNode.y);
            edge.graphics.stroke({ color: lineColor, width: 2, alpha: 0.3 });
          }
        });

        animationRef.current = requestAnimationFrame(simulate);
      };

      simulate();

      // Handle dragging - node follows mouse in real-time
      app.stage.eventMode = 'static';
      app.stage.on('pointermove', (e) => {
        if (isDraggingRef.current) {
          const node = nodesRef.current.get(isDraggingRef.current);
          if (node) {
            const pos = e.global;
            node.x = pos.x;
            node.y = pos.y;
            node.vx = 0;
            node.vy = 0;
            node.graphics.x = node.x;
            node.graphics.y = node.y;
            node.text.x = node.x;
            node.text.y = node.y;
          }
        }
      });

      app.stage.on('pointerup', () => {
        if (isDraggingRef.current) {
          const node = nodesRef.current.get(isDraggingRef.current);
          if (node) {
            node.graphics.cursor = 'grab';
          }
        }
        isDraggingRef.current = null;
        dragStartRef.current = null;
      });

      app.stage.on('pointerupoutside', () => {
        if (isDraggingRef.current) {
          const node = nodesRef.current.get(isDraggingRef.current);
          if (node) {
            node.graphics.cursor = 'grab';
          }
        }
        isDraggingRef.current = null;
        dragStartRef.current = null;
      });
    };

    initPixi();

    return () => {
      cancelAnimationFrame(animationRef.current);
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
    };
  }, [people, navigate]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">
            Connection Graph
          </h1>
          <p className="text-sm text-muted-foreground">
            Visualize relationships between people
          </p>
        </div>
        <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-connection">
          <Plus className="h-4 w-4" />
          Add Connection
        </Button>
      </div>

      <div className="flex-1 relative bg-background">
        {people.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h3 className="text-lg font-medium mb-2">No people to display</h3>
            <p className="text-sm text-muted-foreground">
              Add some people to see the connection graph
            </p>
          </div>
        ) : (
          <div ref={canvasRef} className="w-full h-full" />
        )}
      </div>

      <AddConnectionDialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen} />
    </div>
  );
}
