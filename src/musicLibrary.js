// Vite imports URLs only. MP3 data is requested on demand by one audio element,
// rather than downloaded/decoded alongside the studio's JavaScript.
const halloween = import.meta.glob('../assets/BGM/*.mp3', { eager:true, query:'?url', import:'default' });

// Keep seasonal music independent of the player and visual theme. Add another
// library here when other moods are ready; these tracks are Halloween-only.
export const MUSIC_THEMES = {
  halloween: { label:'Halloween', tracks:Object.keys(halloween).sort().map(path=>halloween[path]) },
};
