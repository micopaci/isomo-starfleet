import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { DailyScore } from '@starfleet/shared';
import { Colors, scoreColor } from '../theme/colors';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';

interface Props {
  scores: DailyScore[];
  colors: Colors;
}

const W  = Dimensions.get('window').width - 60;
const H  = 100;
const PAD_V = 14;
const PAD_H = 24;

export function SparkLine({ scores, colors }: Props) {
  if (!scores || scores.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: colors.ink3 }]}>No history yet</Text>
      </View>
    );
  }

  const data    = scores.slice(-7);
  const max     = Math.max(...data.map(s => s.score), 100);
  const min     = Math.min(...data.map(s => s.score), 0);
  const range   = max - min || 1;

  const cx = (i: number) => PAD_H + (i / (data.length - 1 || 1)) * (W - PAD_H * 2);
  const cy = (v: number) => PAD_V + ((max - v) / range) * (H - PAD_V * 2);

  const points = data.map((s, i) => `${cx(i)},${cy(s.score)}`).join(' ');
  const lastScore  = data[data.length - 1]?.score ?? 0;
  const lineColor  = scoreColor(lastScore, colors);

  // Axis tick labels (day numbers)
  const ticks = data.map((s, i) => ({
    x:   cx(i),
    y:   H - 2,
    lbl: `D${i + 1}`,
  }));

  return (
    <Svg width={W} height={H}>
      {/* Grid line at 80 */}
      <Line
        x1={PAD_H} y1={cy(80)} x2={W - PAD_H} y2={cy(80)}
        stroke={colors.rule} strokeWidth={0.8} strokeDasharray="3,3"
      />
      {/* Grid line at 50 */}
      <Line
        x1={PAD_H} y1={cy(50)} x2={W - PAD_H} y2={cy(50)}
        stroke={colors.rule} strokeWidth={0.8} strokeDasharray="3,3"
      />
      {/* Sparkline */}
      <Polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Tick labels */}
      {ticks.map(t => (
        <SvgText
          key={t.lbl}
          x={t.x}
          y={t.y}
          textAnchor="middle"
          fill={colors.muted}
          fontSize={9}
        >
          {t.lbl}
        </SvgText>
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  empty:     { height: 80, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 13 },
});
