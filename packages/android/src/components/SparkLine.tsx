import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CartesianChart with Line, VictoryChart, CartesianChart with Axis, VictoryAxis } from 'victory-native';
import { DailyScore } from '@starfleet/shared';
import { Colors, scoreColor } from '../theme/colors';

interface Props {
  scores: DailyScore[];
  colors: Colors;
}

export function SparkLine({ scores, colors }: Props) {
  if (!scores || scores.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: colors.text2 }]}>No history yet</Text>
      </View>
    );
  }

  // Last 7 days
  const data = scores.slice(-7).map((s, i) => ({ x: i + 1, y: s.score }));

  // Line colour from last score
  const lastScore = scores[scores.length - 1]?.score ?? 0;
  const lineColor = scoreColor(lastScore);

  return (
    <VictoryChart
      height={120}
      padding={{ top: 10, bottom: 24, left: 10, right: 10 }}
    >
      <VictoryAxis
        style={{
          axis:     { stroke: colors.border },
          tickLabels: { fill: colors.text2, fontSize: 10 },
          grid:     { stroke: 'transparent' },
        }}
        tickFormat={(t: number) => `D${t}`}
      />
      <VictoryLine
        data={data}
        style={{ data: { stroke: lineColor, strokeWidth: 2 } }}
        animate={{ duration: 400 }}
      />
    </VictoryChart>
  );
}

const styles = StyleSheet.create({
  empty:     { height: 80, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 13 },
});
