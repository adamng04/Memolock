import type { AccentColorId } from './types'

export interface AccentColor {
  id: AccentColorId
  label: string
  swatch: string
  action: string
}

export const accentPalette: readonly AccentColor[] = [
  { id: 'rose', label: 'Rose', swatch: '#d96b82', action: '#8f2945' },
  { id: 'coral', label: 'Coral', swatch: '#e77c67', action: '#91402f' },
  { id: 'orange', label: 'Orange', swatch: '#e58a46', action: '#8c4a18' },
  { id: 'amber', label: 'Amber', swatch: '#d99a31', action: '#7f510c' },
  { id: 'gold', label: 'Gold', swatch: '#c8a43b', action: '#70570b' },
  { id: 'lime', label: 'Lime', swatch: '#91b84d', action: '#486817' },
  { id: 'leaf', label: 'Leaf', swatch: '#72a34f', action: '#35621f' },
  { id: 'emerald', label: 'Emerald', swatch: '#409b6d', action: '#17603b' },
  { id: 'teal', label: 'Teal', swatch: '#3d9a8d', action: '#145e56' },
  { id: 'cyan', label: 'Cyan', swatch: '#409aad', action: '#145c6b' },
  { id: 'sky', label: 'Sky', swatch: '#5797c5', action: '#285b83' },
  { id: 'blue', label: 'Blue', swatch: '#527fc2', action: '#294f8d' },
  { id: 'indigo', label: 'Indigo', swatch: '#666fc0', action: '#3e478d' },
  { id: 'violet', label: 'Violet', swatch: '#866bc1', action: '#58398d' },
  { id: 'purple', label: 'Purple', swatch: '#9b66b2', action: '#65347c' },
  { id: 'magenta', label: 'Magenta', swatch: '#b85d9d', action: '#7a2864' },
  { id: 'pink', label: 'Pink', swatch: '#d270a4', action: '#8a315f' },
  { id: 'berry', label: 'Berry', swatch: '#b95572', action: '#76233e' },
  { id: 'red', label: 'Red', swatch: '#cf5c55', action: '#842d27' },
  { id: 'brick', label: 'Brick', swatch: '#b66d55', action: '#743c29' },
  { id: 'cocoa', label: 'Cocoa', swatch: '#96715e', action: '#594034' },
  { id: 'sand', label: 'Sand', swatch: '#aa8c62', action: '#665034' },
  { id: 'olive', label: 'Olive', swatch: '#858b49', action: '#4d531d' },
  { id: 'forest', label: 'Forest', swatch: '#4f7f5b', action: '#285035' },
  { id: 'ocean', label: 'Ocean', swatch: '#467f91', action: '#245265' },
  { id: 'navy', label: 'Navy', swatch: '#556b8e', action: '#334561' },
  { id: 'slate', label: 'Slate', swatch: '#687985', action: '#3d4c55' },
  { id: 'lavender', label: 'Lavender', swatch: '#9785ba', action: '#5e4a83' },
  { id: 'mint', label: 'Mint', swatch: '#63a98e', action: '#2f6653' },
  { id: 'graphite', label: 'Graphite', swatch: '#707673', action: '#414744' },
]
