/**
 * MapScreen — Rwanda fleet map for Starfleet Android.
 *
 * Renders the high-res 5-province Rwanda SVG (same province paths as web)
 * with a pin for every campus.  Tapping a pin selects it and shows a
 * summary card at the bottom.
 */
import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, useColorScheme,
  Dimensions, Platform,
} from 'react-native';
import Svg, { G, Path, Ellipse, Circle, Text as SvgText, ClipPath, Defs } from 'react-native-svg';
import { useFleetSummary } from '@starfleet/shared';
import { light, dark, Colors, scoreColor } from '../theme/colors';

// ─── Rwanda geography ────────────────────────────────────────────────────────

/** Geographic bounds of Rwanda — must match web project() */
const RW = { minLat: -2.84, maxLat: -1.05, minLng: 28.86, maxLng: 30.90 };
const VW = 1000; // SVG viewBox width
const VH = 800;  // SVG viewBox height

function project(lat: number, lng: number): { x: number; y: number } {
  if (lat == null || lng == null) return { x: -999, y: -999 };
  const x = ((lng - RW.minLng) / (RW.maxLng - RW.minLng)) * VW;
  const y = ((RW.maxLat - lat) / (RW.maxLat - RW.minLat)) * VH;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Transform that maps rwandaHigh.svg coords → VW×VH viewport */
const RW_TRANSFORM = 'translate(2.0747 -56.8927) scale(1.037344 0.951860)';

/** Five province path strings from rwandaHigh.svg */
const RW_PROVINCES = [
  {
    id: 'RW-01',
    d: 'M548.69,541.06L539.85,538.12L535.83,535.62L532.95,529.85L533.85,525.3L537.3,521.76L541.13,520.24L544.96,514.8L541.89,507.52L537.39,500.47L539.9,495.03L541.27,487.27L537.06,477.34L534.75,473.93L531.34,464.09L534.37,462.25L529.92,449.38L532,444.6L539.47,432.4L544.01,430.84L556.16,438.88L562.36,435.19L570.11,425.82L579.71,421.52L591.29,419.44L595.78,420.15L598.38,416.84L604.01,402.6L615.54,408.84L631.14,419.2L645.89,429.7L653.6,432.26L657.1,432.78L657.71,435.28L660.93,439.87L662.72,446.73L662.39,453.26L668.11,459.64L669.11,467.4L668.92,476.67L666.7,480.65L653.46,486.66L650.91,489.59L649.16,512.11L646.04,529.18L642.3,537.75L639.09,542.29L632.42,533.49L624.24,522.04L618.47,520.38L612.71,522.42L604.95,526.06L598.81,530.89L597.67,532.64L590.86,533.35L575.07,537.13L568.12,537.04L564.2,532.12L560.8,533.01L558.34,535.62L550.87,539.26Z',
  },
  {
    id: 'RW-03',
    d: 'M571.48,216.97L577.48,220.47L579,225.29L581.6,228.88L584.67,231.34L590.63,241.32L595.92,249.27L600.04,256.98L606.13,270.31L607.65,281.95L617.58,278.68L622.21,278.68L624.62,282.23L620.84,285.64L618.33,293.58L620.32,304.13L623.96,313.78L628.64,322.19L634.78,328.67L643.34,339.84L652.56,351.23L659.27,358.56L662.06,364.9L658.66,375.59L660.36,385.52L665.23,401.75L668.92,416.27L669.06,423.46L662.3,427.86L657.1,432.78L653.6,432.26L645.89,429.7L631.14,419.2L615.54,408.84L604.01,402.6L598.38,416.84L595.78,420.15L591.29,419.44L579.71,421.52L570.11,425.82L562.36,435.19L556.16,438.88L544.01,430.84L539.47,432.4L532,444.6L529.92,449.38L534.37,462.25L531.34,464.09L526.33,462.53L521.75,459.41L510.35,447.82L499.86,441.15L494.14,439.45L485.86,439.26L476.5,440.96L467.38,441.06L454.47,436.66L445.49,430.93L443.12,424.17L436.51,417.88L419.82,392.34L418.11,387.94L414.47,387.37L408.56,388.46L399.68,385.19L391.92,380.04L386.63,379.09L378.45,380.7L373.34,376.82L367.48,369.73L368.05,359.42L368.24,345.7L367.58,326.36L365.64,312.03L356.32,311.36L346.77,311.88L325.97,302L318.98,303.37L299.83,296.99L288.43,283.6L277.94,269.18L287.02,254.8L303.28,237.87L322.14,224.25L340.72,217.68L359.73,218.72L369.66,217.96L378.45,215.55L388.19,210.11L395.52,204.81L403.41,200.7L414.9,198.67L420.53,199.94L430.6,206.04L433.86,207.23L437.78,204.91L440.62,195.59L444.87,190.49L449.27,187.74L453.34,186.56L457.59,187.17L462.79,189.82L476.08,209.12L478.16,219.05L479.29,238.48L483.88,248.51L492.01,256.08L501.23,258.73L511.2,257.64L521.56,253.81L553.66,235.98L558.57,234.99L562.88,224.68L569.02,218.29Z',
  },
  {
    id: 'RW-04',
    d: 'M213.83,833.48L212.18,827.09L212.46,819.28L206.69,815.02L198.04,810.05L188.07,807.64L168.12,805.18L157.53,801.96L128.83,789.42L121.12,788.28L93.66,790.08L82.92,800.64L74.79,847.96L67.56,839.92L57.87,835.09L43.73,833.58L37.44,831.11L19.81,819.57L16.12,815.78L19.34,779.62L16.12,768.64L11.3,763.67L5.96,761.17L1.8,758.28L0,752.18L1.75,745.98L9.93,738.64L8.27,732.87L3.5,724.3L1.75,714.93L0.76,704.81L4.3,692.36L10.97,686.68L23.69,682.28L33.52,679.4L41.7,674.52L48.46,667.71L53.9,659.15L57.49,652.1L59.66,642.92L64.53,638.33L68.5,636.91L82.12,637.38L103.16,631.8L119.42,618.93L131.24,600.48L138.71,578.1L141.4,558.37L140.46,541.34L127.88,467.07L126.84,449.76L129.21,432.82L138.1,412.01L167.88,364.43L177.81,345.51L183.53,337.14L206.36,318.22L211.14,312.03L224.09,285.3L229.58,278.26L237,275.14L273.12,273.67L276.33,271.68L277.94,269.18L288.43,283.6L299.83,296.99L318.98,303.37L325.97,302L346.77,311.88L356.32,311.36L365.64,312.03L367.58,326.36L368.24,345.7L368.05,359.42L367.48,369.73L373.34,376.82L378.45,380.7L379.63,382.4L382.85,395.79L384.41,411.68L383.13,424.83L381.57,430.32L381.43,436.04L383.65,447.68L384.97,460.21L380.72,469.96L380.81,475.21L384.74,484.34L383.65,489.3L379.3,493.23L373.82,494.93L361.9,494.65L364.03,499.38L365.73,509.79L365.26,519.82L368.33,528.28L366.63,540.77L361.05,549.1L358.12,554.4L358.12,557.9L355.43,564.47L351.08,572.42L350.6,577.25L353.72,586.71L353.91,593.19L341.72,600.1L334.39,602.61L328.9,600.57L324.18,606.25L318.17,609.99L313.02,614.53L306.68,618.08L294.96,627.26L288.06,634.4L285.17,634.02L271.42,634.45L261.87,636.01L253.07,642.63L247.02,645.33L241.73,643.72L234.68,644.81L227.54,648.5L222.77,654.18L221.49,660.61L227.83,675L227.45,679.35L218.75,693.21L221.54,703.01L219.6,707.32L199.93,717.96L195.82,723.97L193.69,730.22L194.12,733.39L199.84,736.46L208.63,739.26L214.97,742.14L218.89,747.4L219.93,754.59L222.77,760.5L226.31,765.24L230.62,772.81L229.15,781.8L229.81,785.16L237.71,796.8L236.1,813.89L229.43,825.81L222.77,828.79Z',
  },
  {
    id: 'RW-05',
    d: 'M519.85,661.65L512.81,656.73L507.99,656.88L506.62,659.52L506.66,663.93L503.59,688.15L506.99,724.49L496.74,760.27L494.56,814.08L492.01,824.49L487.52,834.81L481.75,844.6L475.46,853.17L465.77,862.97L456.88,868.22L447.33,870.02L435.56,869.69L425.02,866.52L419.58,866.56L416.08,870.97L414.52,880.91L412.44,885.31L407.86,888.1L397.27,889.43L388.38,888.05L363.65,879.86L360.3,879.68L346.21,884.74L338.93,888.38L334.06,888.2L323.66,889.57L314.82,895.15L305.83,898.23L294.86,891.98L268.63,887.11L260.12,888.1L239.74,896.95L228.11,897.99L223.95,889L223.38,883.08L218.99,873.24L217.9,867.79L219.51,862.83L226.03,854.83L227.07,849.43L224.19,843.56L213.83,833.48L222.77,828.79L229.43,825.81L236.1,813.89L237.71,796.8L229.81,785.16L229.15,781.8L230.62,772.81L226.31,765.24L222.77,760.5L219.93,754.59L218.89,747.4L214.97,742.14L208.63,739.26L199.84,736.46L194.12,733.39L193.69,730.22L195.82,723.97L199.93,717.96L219.6,707.32L221.54,703.01L218.75,693.21L227.45,679.35L227.83,675L221.49,660.61L222.77,654.18L227.54,648.5L234.68,644.81L241.73,643.72L247.02,645.33L253.07,642.63L261.87,636.01L271.42,634.45L285.17,634.02L288.06,634.4L294.96,627.26L306.68,618.08L313.02,614.53L318.17,609.99L324.18,606.25L328.9,600.57L334.39,602.61L341.72,600.1L353.91,593.19L353.72,586.71L350.6,577.25L351.08,572.42L355.43,564.47L358.12,557.9L358.12,554.4L361.05,549.1L366.63,540.77L368.33,528.28L365.26,519.82L365.73,509.79L364.03,499.38L361.9,494.65L373.82,494.93L379.3,493.23L383.65,489.3L384.74,484.34L380.81,475.21L380.72,469.96L384.97,460.21L383.65,447.68L381.43,436.04L381.57,430.32L383.13,424.83L384.41,411.68L382.85,395.79L379.63,382.4L378.45,380.7L386.63,379.09L391.92,380.04L399.68,385.19L408.56,388.46L414.47,387.37L418.11,387.94L419.82,392.34L436.51,417.88L443.12,424.17L445.49,430.93L454.47,436.66L467.38,441.06L476.5,440.96L485.86,439.26L494.14,439.45L499.86,441.15L510.35,447.82L521.75,459.41L526.33,462.53L531.34,464.09L534.75,473.93L537.06,477.34L541.27,487.27L539.9,495.03L537.39,500.47L541.89,507.52L544.96,514.8L541.13,520.24L537.3,521.76L533.85,525.3L532.95,529.85L535.83,535.62L539.85,538.12L548.69,541.06L548.17,545.65L548.08,559.7L544.96,565.42L537.91,573.13L532.86,582.97L533.61,598.63L531.01,621.86L525.1,639.04L523.26,648.78L522.12,657.87Z',
  },
  {
    id: 'RW-02',
    d: 'M519.85,661.65L522.12,657.87L523.26,648.78L525.1,639.04L531.01,621.86L533.61,598.63L532.86,582.97L537.91,573.13L544.96,565.42L548.08,559.7L548.17,545.65L548.69,541.06L550.87,539.26L558.34,535.62L560.8,533.01L564.2,532.12L568.12,537.04L575.07,537.13L590.86,533.35L597.67,532.64L598.81,530.89L604.95,526.06L612.71,522.42L618.47,520.38L624.24,522.04L632.42,533.49L639.09,542.29L642.3,537.75L646.04,529.18L649.16,512.11L650.91,489.59L653.46,486.66L666.7,480.65L668.92,476.67L669.11,467.4L668.11,459.64L662.39,453.26L662.72,446.73L660.93,439.87L657.71,435.28L657.1,432.78L662.3,427.86L669.06,423.46L668.92,416.27L665.23,401.75L660.36,385.52L658.66,375.59L662.06,364.9L659.27,358.56L652.56,351.23L643.34,339.84L634.78,328.67L628.64,322.19L623.96,313.78L620.32,304.13L618.33,293.58L620.84,285.64L624.62,282.23L622.21,278.68L617.58,278.68L607.65,281.95L606.13,270.31L600.04,256.98L595.92,249.27L590.63,241.32L584.67,231.34L581.6,228.88L579,225.29L577.48,220.47L571.48,216.97L585.43,209.5L604.72,201.98L609.87,197.2L612.33,190.01L615.16,171.66L618.57,165.23L622.26,163.01L629.82,162.11L633.27,161.07L640.6,156.72L661.64,136.72L667.83,128.82L672.89,120.26L674.83,110.33L676.2,107.5L679.55,104.75L687.45,101.21L690.33,98.79L692.79,91.61L695.82,72.08L699.84,65.32L707.07,62.76L714.87,63.9L722.91,66.26L730.9,67.3L738.32,65.41L744.51,62.67L750.94,61.77L763.33,65.6L759.59,69.52L755.95,74.73L754.44,80.02L756,85.13L762.9,89.86L764.46,96.34L760.4,104.61L761.2,107.45L765.36,110.24L769.1,109.67L774.16,107.45L779.97,111.66L781.96,114.59L783.8,126.84L786.68,133.69L795.29,147.97L798.08,157.62L802.47,163.34L803.42,167.17L800.77,173.51L800.25,177.01L802.81,184.57L808.9,189.16L822.85,194.93L827.81,198.48L834.91,205.19L839.26,207.84L870.51,219.43L879.77,220.75L888.94,226.33L891.64,238.67L890.79,251.02L889.32,256.6L886.77,259.29L889.61,265.49L897.41,275.94L903.27,282.18L905.4,285.82L909.98,302.8L914.52,313.49L921.9,319.31L933.15,315.01L936.6,325.03L936.22,337.19L930.12,374.46L929.93,379.57L935.23,388.46L936.41,392.81L930.97,405.82L932.63,410.78L936.41,429.75L933.81,437.79L928.99,444.89L926.34,452.17L929.93,460.64L922.27,466.65L917.07,473.5L931.21,475.78L932.63,488.31L926.43,515.79L935.27,513.9L943.78,518.16L950.97,525.4L956.03,532.26L960,545.98L943.74,598.63L939.62,619.45L941.61,651.86L939.62,661.46L934.75,670.31L928.61,674.76L920.67,678.31L913.34,682.52L906.77,684.13L899.01,687.25L895.18,686.31L870.51,674.15L865.4,672.54L859.3,673.34L853.86,677.6L847.15,690.33L841.86,694.78L831.93,695.3L821.67,692.36L811.6,691.13L802.47,696.48L786.92,695.91L771.22,688.53L745.51,667.43L742.81,663.74L740.35,657.06L736.52,655.08L721.54,651.48L719.27,650.35L711.66,652.57L707.07,656.88L702.91,662.32L696.86,667.95L690.05,671.4L681.16,674.29L672.13,676.13L664.47,676.51L658.61,675.19L643.86,667.99L638.38,667.43L636.67,670.64L635.45,678.4L614.12,705.19L606.04,710.77L595.5,711.1L584.67,706.89L574.79,700.36L566.99,693.55L552.33,676.18L546.57,671.73L541.18,669.84L532.67,670.08L528.98,669.56Z',
  },
];

/** Lakes — GPS-projected into our VW×VH space */
const LAKES = [
  { cx: 54,  cy: 434, rx: 16, ry: 200, label: 'LAKE KIVU',   lx: 80,  ly: 434 },
  { cx: 723, cy: 366, rx: 55, ry: 11,  label: 'LAKE MUHAZI', lx: 723, ly: 350 },
  { cx: 866, cy: 429, rx: 41, ry: 38,  label: 'LAKE IHEMA',  lx: 866, ly: 405 },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function MapScreen() {
  const scheme = useColorScheme();
  const C: Colors = scheme === 'dark' ? dark : light;

  const { sites, loading } = useFleetSummary();

  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected = useMemo(
    () => sites.find(s => s.id === selectedId) ?? null,
    [sites, selectedId],
  );

  // Compute each campus pin position
  const pins = useMemo(() =>
    sites.map(s => ({
      ...s,
      ...project(Number(s.lat), Number(s.lng)),
    })),
    [sites],
  );

  // Map fills full width; height = 4/5 aspect
  const screenW = Dimensions.get('window').width;
  const mapH = screenW * (VH / VW);

  const bg        = C.bg;
  const surface2  = C.surface2;
  const rule      = C.rule;
  const accentSoft = C.accentSoft;
  const ink3      = C.ink3;
  const lakeBlue  = scheme === 'dark' ? '#2a4a6a' : '#b8d4e8';
  const lakeStroke = scheme === 'dark' ? '#1e3550' : '#9cbdd4';

  return (
    <View style={[styles.screen, { backgroundColor: bg }]}>
      {/* ── Map SVG ── */}
      <View style={[styles.mapWrap, { backgroundColor: surface2 }]}>
        <Svg
          width={screenW}
          height={mapH}
          viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="xMidYMid slice"
        >
          <Defs>
            <ClipPath id="rwClip">
              <G transform={RW_TRANSFORM}>
                {RW_PROVINCES.map(p => (
                  <Path key={p.id} d={p.d} />
                ))}
              </G>
            </ClipPath>
          </Defs>

          {/* Background */}
          <Path
            d={`M0 0 H${VW} V${VH} H0 Z`}
            fill={surface2}
          />

          {/* Province fills */}
          <G transform={RW_TRANSFORM}>
            {RW_PROVINCES.map(p => (
              <Path
                key={p.id}
                d={p.d}
                fill={bg}
                stroke={rule}
                strokeWidth={0.7}
                strokeLinejoin="round"
              />
            ))}
          </G>

          {/* Accent glow */}
          <G transform={RW_TRANSFORM} opacity={0.35}>
            {RW_PROVINCES.map(p => (
              <Path
                key={'a' + p.id}
                d={p.d}
                fill="none"
                stroke={accentSoft}
                strokeWidth={3.5}
                strokeLinejoin="round"
              />
            ))}
          </G>

          {/* Lakes — clipped to Rwanda */}
          <G clipPath="url(#rwClip)">
            {LAKES.map(l => (
              <Ellipse
                key={l.label}
                cx={l.cx}
                cy={l.cy}
                rx={l.rx}
                ry={l.ry}
                fill={lakeBlue}
                stroke={lakeStroke}
                strokeWidth={1}
                opacity={0.7}
              />
            ))}
          </G>

          {/* Lake labels */}
          {LAKES.map(l => (
            <SvgText
              key={l.label + '-lbl'}
              x={l.lx}
              y={l.ly}
              fontSize={9}
              fill={ink3}
              fontFamily={Platform.OS === 'ios' ? 'Menlo' : 'monospace'}
              letterSpacing={0.8}
              textAnchor="middle"
            >
              {l.label}
            </SvgText>
          ))}

          {/* Pins — unselected first, then selected on top */}
          {[...pins.filter(p => p.id !== selectedId), ...pins.filter(p => p.id === selectedId)]
            .map(p => {
              const isSel = p.id === selectedId;
              const tone = p.score != null
                ? scoreColor(Number(p.score), C)
                : C.muted;
              const OUTER = 10;
              const INNER = isSel ? 6 : 4;
              const sw    = isSel ? 2.5 : 1.5;
              return (
                <G key={p.id} onPress={() => setSelectedId(isSel ? null : p.id)}>
                  <Circle cx={p.x} cy={p.y} r={OUTER + 6} fill="transparent" />
                  <Circle cx={p.x} cy={p.y} r={OUTER} fill={bg} stroke={tone} strokeWidth={sw} />
                  <Circle cx={p.x} cy={p.y} r={INNER} fill={tone} />
                </G>
              );
            })
          }
        </Svg>
      </View>

      {/* ── Selected site card ── */}
      {selected ? (
        <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.rule }]}>
          <View style={styles.cardRow}>
            <View style={styles.cardMain}>
              <Text style={[styles.cardName, { color: C.ink }]} numberOfLines={1}>
                {selected.name}
              </Text>
              <Text style={[styles.cardSub, { color: C.ink3 }]}>
                {(selected as any).site_code ?? '—'} · {(selected as any).site_type ?? 'School'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setSelectedId(null)}
              hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <Text style={[styles.dismiss, { color: C.muted }]}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.metrics, { borderTopColor: C.rule }]}>
            <Metric label="DISHES" value={`${(selected as any).dishes_online ?? 0}/${(selected as any).dishes_total ?? 0}`} color={C.ink2} />
            <Metric label="SCORE" value={(selected as any).score_7day_avg != null ? `${Math.round((selected as any).score_7day_avg)}%` : '—'} color={scoreColor(Number((selected as any).score_7day_avg ?? 0), C)} />
            <Metric label="COMPUTERS" value={String((selected as any).devices_online ?? 0)} color={C.ink2} />
          </View>
        </View>
      ) : (
        <View style={[styles.hint, { backgroundColor: C.surface }]}>
          <Text style={[styles.hintText, { color: C.muted }]}>
            {loading ? 'Loading sites…' : `${sites.length} sites · tap a pin to select`}
          </Text>
        </View>
      )}
    </View>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.metricCol}>
      <Text style={[styles.metricVal, { color }]}>{value}</Text>
      <Text style={styles.metricLbl}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:    { flex: 1 },
  mapWrap:   { width: '100%' },

  card: {
    margin: 12, borderRadius: 10, borderWidth: 1,
    overflow: 'hidden',
  },
  cardRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
  },
  cardMain:  { flex: 1 },
  cardName:  { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  cardSub:   { fontSize: 12 },
  dismiss:   { fontSize: 16, paddingLeft: 12 },
  metrics: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  metricCol: { flex: 1, alignItems: 'center' },
  metricVal: { fontSize: 16, fontWeight: '700' },
  metricLbl: { fontSize: 10, color: '#9e9a8b', marginTop: 2, letterSpacing: 0.5 },

  hint: {
    margin: 12, borderRadius: 8,
    paddingVertical: 12, alignItems: 'center',
  },
  hintText: { fontSize: 13 },
});
