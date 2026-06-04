// Small SVG accessories layered on top of a Kenney character sprite so the
// agent's ROLE is visible at a glance (not just its color).
// Each overlay is designed for a 16×16 character canvas. Sub-overlays are
// small (4-8 px) and use 1-2 strong colors with a 1px outline.
//
// Imported from KenneyCharacter. Receives the archetype + accent color.

import type { JSX } from 'react';
import type { Archetype } from '@core/types/genesis';

interface OverlayProps {
  archetype: Archetype;
  accent: string;
}

const OUTLINE = '#070912';

// Each subcomponent renders inside the 16×16 character viewBox.
// Anchor positions are tuned so the overlay sits next to the head/torso
// without covering the face.

function SentinelShield({ accent }: { accent: string }): JSX.Element {
  // small shield top-right of head
  return (
    <g shapeRendering="crispEdges">
      <rect x={12} y={1} width={4} height={1} fill={OUTLINE} />
      <rect x={11} y={2} width={6} height={5} fill={OUTLINE} />
      <rect x={12} y={3} width={4} height={3} fill={accent} />
      <rect x={12} y={3} width={4} height={1} fill="#ffb547" />
      <rect x={13} y={6} width={2} height={1} fill={OUTLINE} />
    </g>
  );
}

function GuardianLock({ accent }: { accent: string }): JSX.Element {
  // small lock top-right
  return (
    <g shapeRendering="crispEdges">
      <rect x={12} y={2} width={3} height={1} fill={OUTLINE} />
      <rect x={12} y={3} width={1} height={1} fill={OUTLINE} />
      <rect x={14} y={3} width={1} height={1} fill={OUTLINE} />
      <rect x={11} y={4} width={5} height={4} fill={OUTLINE} />
      <rect x={12} y={5} width={3} height={2} fill={accent} />
      <rect x={13} y={6} width={1} height={1} fill={OUTLINE} />
    </g>
  );
}

function AnalystGlasses({ accent }: { accent: string }): JSX.Element {
  // small glasses on head — accent shine on lenses
  return (
    <g shapeRendering="crispEdges">
      <rect x={5} y={5} width={6} height={1} fill={OUTLINE} />
      <rect x={5} y={6} width={2} height={2} fill={accent} opacity={0.85} />
      <rect x={9} y={6} width={2} height={2} fill={accent} opacity={0.85} />
      <rect x={7} y={7} width={2} height={1} fill={OUTLINE} />
    </g>
  );
}

function ScientistFlask({ accent }: { accent: string }): JSX.Element {
  // small flask top-right
  return (
    <g shapeRendering="crispEdges">
      <rect x={13} y={1} width={2} height={1} fill={OUTLINE} />
      <rect x={13} y={2} width={2} height={1} fill={OUTLINE} />
      <rect x={12} y={3} width={4} height={4} fill={OUTLINE} />
      <rect x={13} y={4} width={2} height={2} fill={accent} />
      <rect x={13} y={4} width={2} height={1} fill="#ffd24a" />
    </g>
  );
}

function ListenerHeadset({ accent }: { accent: string }): JSX.Element {
  // headset band over head + earcups
  return (
    <g shapeRendering="crispEdges">
      <rect x={4} y={1} width={8} height={1} fill={accent} />
      <rect x={3} y={2} width={1} height={3} fill={accent} />
      <rect x={12} y={2} width={1} height={3} fill={accent} />
      <rect x={3} y={1} width={1} height={1} fill={OUTLINE} />
      <rect x={12} y={1} width={1} height={1} fill={OUTLINE} />
    </g>
  );
}

function MediatorBubble({ accent }: { accent: string }): JSX.Element {
  // small chat bubble top-right
  return (
    <g shapeRendering="crispEdges">
      <rect x={12} y={1} width={4} height={3} fill={OUTLINE} />
      <rect x={13} y={2} width={2} height={1} fill={accent} />
      <rect x={12} y={4} width={1} height={1} fill={OUTLINE} />
    </g>
  );
}

function ArchivistBook({ accent }: { accent: string }): JSX.Element {
  // small book bottom-right
  return (
    <g shapeRendering="crispEdges">
      <rect x={12} y={9} width={4} height={1} fill={OUTLINE} />
      <rect x={11} y={10} width={5} height={4} fill={OUTLINE} />
      <rect x={12} y={11} width={3} height={2} fill="#e6dac0" />
      <rect x={13} y={11} width={1} height={2} fill={accent} />
    </g>
  );
}

function ReviewerClipboard({ accent }: { accent: string }): JSX.Element {
  // clipboard bottom-right
  return (
    <g shapeRendering="crispEdges">
      <rect x={12} y={9} width={4} height={1} fill={OUTLINE} />
      <rect x={11} y={10} width={5} height={5} fill={OUTLINE} />
      <rect x={12} y={10} width={3} height={4} fill="#e6dac0" />
      <rect x={12} y={10} width={3} height={1} fill={accent} />
      <rect x={13} y={12} width={1} height={1} fill={accent} />
    </g>
  );
}

function CommanderCrown({ accent }: { accent: string }): JSX.Element {
  // small 3-point crown on head
  return (
    <g shapeRendering="crispEdges">
      <rect x={4} y={0} width={1} height={1} fill="#ffd24a" />
      <rect x={6} y={-1} width={2} height={2} fill="#ffd24a" />
      <rect x={9} y={0} width={1} height={1} fill="#ffd24a" />
      <rect x={4} y={1} width={6} height={1} fill={accent} />
    </g>
  );
}

function EngineerWrench({ accent }: { accent: string }): JSX.Element {
  // small wrench bottom-right
  return (
    <g shapeRendering="crispEdges">
      <rect x={12} y={9} width={4} height={1} fill={OUTLINE} />
      <rect x={12} y={9} width={4} height={1} fill={accent} />
      <rect x={13} y={10} width={2} height={4} fill={OUTLINE} />
      <rect x={13} y={10} width={2} height={4} fill={accent} />
    </g>
  );
}

function DesignerPalette({ accent }: { accent: string }): JSX.Element {
  // small palette bottom-right
  return (
    <g shapeRendering="crispEdges">
      <rect x={11} y={10} width={5} height={4} fill={OUTLINE} />
      <rect x={12} y={11} width={3} height={2} fill="#e6dac0" />
      <rect x={12} y={11} width={1} height={1} fill={accent} />
      <rect x={14} y={11} width={1} height={1} fill="#ff4757" />
      <rect x={13} y={12} width={1} height={1} fill="#22d3ee" />
    </g>
  );
}

function BroadcasterMic({ accent }: { accent: string }): JSX.Element {
  // small mic bottom-right
  return (
    <g shapeRendering="crispEdges">
      <rect x={13} y={9} width={2} height={1} fill={OUTLINE} />
      <rect x={12} y={10} width={4} height={3} fill={OUTLINE} />
      <rect x={13} y={11} width={2} height={1} fill={accent} />
      <rect x={13} y={13} width={2} height={1} fill={OUTLINE} />
    </g>
  );
}

export default function RoleOverlay({ archetype, accent }: OverlayProps): JSX.Element | null {
  switch (archetype) {
    case 'commander':   return <CommanderCrown accent={accent} />;
    case 'sentinel':    return <SentinelShield accent={accent} />;
    case 'guardian':    return <GuardianLock accent={accent} />;
    case 'analyst':     return <AnalystGlasses accent={accent} />;
    case 'scientist':   return <ScientistFlask accent={accent} />;
    case 'listener':    return <ListenerHeadset accent={accent} />;
    case 'mediator':    return <MediatorBubble accent={accent} />;
    case 'archivist':   return <ArchivistBook accent={accent} />;
    case 'reviewer':    return <ReviewerClipboard accent={accent} />;
    case 'engineer':    return <EngineerWrench accent={accent} />;
    case 'designer':    return <DesignerPalette accent={accent} />;
    case 'broadcaster': return <BroadcasterMic accent={accent} />;
    default:            return null;
  }
}
