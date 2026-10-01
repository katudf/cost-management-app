import React from 'react';
import { Svg, Path, Rect, Polygon } from '@react-pdf/renderer';
import logo from '../../public/logo-reform-association.svg?raw';

// Preserve all shapes and their attributes from the supplied vector artwork.
const shapes = [...logo.matchAll(/<(path|rect|polygon)\b([^>]+)\/>/g)].map((match) => {
  const props = { fill: '#1f2260' };
  for (const [, name, value] of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
    props[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return { Component: { path: Path, rect: Rect, polygon: Polygon }[match[1]], props };
});

export const ReformAssociationLogoPDF = () => (
  <Svg viewBox="80 30 1460 972" width={66} height={44} style={{ marginLeft: 4 }}>
    {shapes.map(({ Component, props }, i) => <Component key={i} {...props} />)}
  </Svg>
);
