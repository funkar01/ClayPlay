export const STUDIO_THEMES = [
  { id:'clay', name:'Clay Garden', description:'Warm ivory, terracotta & forest green', colors:['#eadfd2','#fffaf5','#326b49','#c96f50'],
    tokens:['#f5efe7','#eadfd2','#fffaf5','#ffffff','#e3cfac','#44382f','#62503f','#806449','#326b49','#ffffff','#7050a0','#c96f50'], dark:false },
  { id:'lilac', name:'Lilac Playground', description:'Soft lavender, grape & peach', colors:['#e9e3f5','#fbf8ff','#7044a8','#f2b29c'],
    tokens:['#f3eef9','#e9e3f5','#fbf8ff','#ffffff','#dac9ec','#362744','#5d496f','#785a92','#7044a8','#ffffff','#ad4b35','#b35c43'], dark:false },
  { id:'lagoon', name:'Lagoon Club', description:'Seafoam, deep teal & sunny yellow', colors:['#dceee9','#f5fcf9','#116b66','#f0c85a'],
    tokens:['#edf6f2','#dceee9','#f5fcf9','#ffffff','#c4dfd0','#183d3a','#3f5e56','#507762','#116b66','#ffffff','#8b5517','#a86824'], dark:false },
  { id:'midnight', name:'Midnight Muse', description:'Inky plum, orchid & mint', colors:['#211c30','#3c314b','#c6a4ef','#8cd8bd'],
    tokens:['#191622','#211c30','#3c314b','#655475','#655275','#f4eefb','#dfd3ed','#cdb8e0','#c6a4ef','#271a38','#8cd8bd','#efb398'], dark:true },
  // Original studio palettes inspired by Figma, Framer, Stripe and Linear.
  { id:'pop', name:'Pop Workshop', description:'Warm paper, punchy vermilion & playful blue', colors:['#fffcf4','#c23f24','#315ae7','#f8ce58'], backdropDark:'#35242b',
    tokens:['#fff6e8','#f7e8d5','#fffcf4','#ffffff','#e9d2ae','#24212c','#604f4c','#85613b','#c23f24','#ffffff','#244fd1','#ce4d30'], dark:false },
  { id:'cobalt', name:'Cobalt Canvas', description:'Gallery white, electric cobalt & cool ink', colors:['#ffffff','#2454d3','#161e32','#b8ccff'], backdropDark:'#101f43',
    tokens:['#f1f4fa','#e1e9f7','#ffffff','#f7faff','#cbd8f1','#161e32','#465570','#5b6e95','#2454d3','#ffffff','#8c3c9b','#b65047'], dark:false },
  { id:'aurora', name:'Prism Studio', description:'Airy violet, ocean cyan & berry accents', colors:['#fdfbff','#5940c8','#086f7c','#df91bf'], backdropDark:'#1e244b',
    tokens:['#f4f0ff','#e8e7fc','#fdfbff','#ffffff','#d2c9ee','#242344','#53496f','#705b96','#5940c8','#ffffff','#086f7c','#ab427e'], dark:false },
  { id:'graphite', name:'Graphite Signal', description:'Soft charcoal, periwinkle & luminous mint', colors:['#17191f','#52617c','#a9baff','#8fe0d0'], backdropDark:'#17191f', backdropLight:'#f0f2f7',
    tokens:['#101114','#17191f','#292e39','#506079','#52617c','#f4f5f8','#d6ddeb','#b1c3e4','#a9baff','#161c2d','#8fe0d0','#efb68f'], dark:true },
];
const tokenNames=['--cream','--studio-background','--ui-panel','--ui-raised','--ui-soft','--ink','--muted','--line','--selected-fill','--selected-ink','--ui-focus','--coral'];
export function savedStudioTheme() {
  try { const id=localStorage.getItem('clayplay-studio-theme');return STUDIO_THEMES.some(t=>t.id===id)?id:'clay'; } catch { return 'clay'; }
}
export function applyStudioTheme(id) {
  const theme=STUDIO_THEMES.find(t=>t.id===id);if(!theme)return false;
  const root=document.documentElement;
  root.dataset.studioTheme=id;root.style.colorScheme=theme.dark?'dark':'light';
  tokenNames.forEach((name,i)=>root.style.setProperty(name,theme.tokens[i]));
  root.style.setProperty('--coral-dark',theme.tokens[11]);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme.tokens[0]);
  try {localStorage.setItem('clayplay-studio-theme',id);}catch{}
  return true;
}
