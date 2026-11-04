// Diagram artwork palette. Neutral surfaces follow DSH tokens; accents are artwork colors
// chosen per scheme because DSH's brand token is monochrome (near-black / white).
const ACCENTS = {
  light: {
    node: '#eef3fe', nodeStroke: '#a9bff7',
    decision: '#fef6e7', decisionStroke: '#efc677',
    note: '#fffaeb', noteStroke: '#efd89c',
    cluster: '#f1f3f6', clusterStroke: '#dfe3ea',
    activation: '#dde7fd', lifeline: '#cfd3d9', line: '#8f949b'
  },
  dark: {
    node: '#222b3c', nodeStroke: '#46649f',
    decision: '#2b2619', decisionStroke: '#8a6a2c',
    note: '#29261b', noteStroke: '#6b5a2c',
    cluster: '#202022', clusterStroke: '#343437',
    activation: '#2c3a57', lifeline: '#3d3e41', line: '#8c9097'
  }
};

export const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif';

/** @param {{dark:boolean, canvas:string, text:string, muted:string}} surface resolved DSH colors */
export function mermaidConfig(surface) {
  const a = ACCENTS[surface.dark ? 'dark' : 'light'];
  const { canvas, text, muted } = surface;
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: 30000,
    maxEdges: 400,
    htmlLabels: false,
    // Mermaid 12 defaults to ELK; dagre is its classic layout and keeps ELK out of the bundle.
    layout: 'dagre',
    theme: 'base',
    fontFamily: FONT_FAMILY,
    themeVariables: {
      darkMode: surface.dark, fontFamily: FONT_FAMILY, fontSize: '14px',
      background: canvas, textColor: text, lineColor: a.line,
      primaryColor: a.node, primaryBorderColor: a.nodeStroke, primaryTextColor: text,
      secondaryColor: a.decision, secondaryBorderColor: a.decisionStroke, secondaryTextColor: text,
      tertiaryColor: a.cluster, tertiaryBorderColor: a.clusterStroke, tertiaryTextColor: text,
      mainBkg: a.node, nodeBorder: a.nodeStroke, nodeTextColor: text,
      clusterBkg: a.cluster, clusterBorder: a.clusterStroke, titleColor: text,
      edgeLabelBackground: canvas,
      actorBkg: a.node, actorBorder: a.nodeStroke, actorTextColor: text, actorLineColor: a.lifeline,
      signalColor: a.line, signalTextColor: text,
      labelBoxBkgColor: a.cluster, labelBoxBorderColor: a.clusterStroke, labelTextColor: text, loopTextColor: muted,
      noteBkgColor: a.note, noteBorderColor: a.noteStroke, noteTextColor: text,
      activationBkgColor: a.activation, activationBorderColor: a.nodeStroke,
      sequenceNumberColor: canvas
    },
    flowchart: { htmlLabels: false, curve: 'basis', padding: 12, nodeSpacing: 32, rankSpacing: 40, diagramPadding: 8, minNodeWidth: 64, useMaxWidth: false },
    sequence: { useMaxWidth: false, mirrorActors: false, width: 104, height: 44, actorMargin: 40, boxMargin: 8, messageMargin: 30, noteMargin: 10, actorFontSize: 14, messageFontSize: 13, noteFontSize: 13, diagramMarginX: 8, diagramMarginY: 8 },
    class: { htmlLabels: false, useMaxWidth: false },
    state: { useMaxWidth: false, minNodeWidth: 64 },
    er: { useMaxWidth: false },
    gantt: { useMaxWidth: false, fontSize: 12 },
    // Mermaid scopes themeCSS under the diagram's own id.
    themeCSS: `
      .node rect, .node circle, .node ellipse, .node path, .node polygon, rect.actor, .note { stroke-width: 1.5px; filter: none !important; }
      .node rect { rx: 8px; ry: 8px; }
      .node polygon { fill: ${a.decision}; stroke: ${a.decisionStroke}; }
      .flowchart-link, .edgePath .path { stroke-width: 1.5px; }
      .edgeLabel, .edgeLabel text, .edgeLabel tspan { fill: ${muted}; color: ${muted}; font-size: 13px; }
      .edgeLabel rect, .labelBkg { fill: ${canvas}; opacity: 1; }
      .cluster rect { rx: 10px; ry: 10px; stroke-dasharray: 4 3; }
      rect.actor { rx: 8px; ry: 8px; stroke-width: 1.5px; }
      .actor-line { stroke-dasharray: 3 4; }
      .messageLine0, .messageLine1 { stroke-width: 1.5px; }
      .messageText { fill: ${text}; }
      rect.note { rx: 6px; ry: 6px; }
      .loopLine { stroke: ${a.clusterStroke}; stroke-width: 1.5px; }
      .labelBox { rx: 4px; }
    `,
    secure: ['securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'layout']
  };
}

const TYPE_NAMES = {
  zh: { flowchart: '流程图', graph: '流程图', sequenceDiagram: '时序图', classDiagram: '类图', stateDiagram: '状态图', 'stateDiagram-v2': '状态图', erDiagram: 'ER 图', gantt: '甘特图', pie: '饼图', journey: '用户旅程', gitGraph: 'Git 图', mindmap: '思维导图', timeline: '时间线' },
  en: { flowchart: 'Flowchart', graph: 'Flowchart', sequenceDiagram: 'Sequence', classDiagram: 'Class', stateDiagram: 'State', 'stateDiagram-v2': 'State', erDiagram: 'ER diagram', gantt: 'Gantt', pie: 'Pie chart', journey: 'User journey', gitGraph: 'Git graph', mindmap: 'Mind map', timeline: 'Timeline' }
};
export function typeName(type, locale) {
  const table = TYPE_NAMES[String(locale).startsWith('zh') ? 'zh' : 'en'];
  return table[type] || type || 'Mermaid';
}
