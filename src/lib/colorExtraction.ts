export async function extractDominantColors(dataBase64: string, mimeType: string): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve([]);
      
      const MAX_DIM = 128;
      const scale = Math.min(MAX_DIM / img.width, MAX_DIM / img.height);
      const width = img.width * scale;
      const height = img.height * scale;
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      const imageData = ctx.getImageData(0, 0, width, height).data;
      const colorCounts: Record<string, number> = {};
      
      for (let i = 0; i < imageData.length; i += 4) {
        // Bin colors to reduce noise
        const r = Math.round(imageData[i] / 32) * 32;
        const g = Math.round(imageData[i+1] / 32) * 32;
        const b = Math.round(imageData[i+2] / 32) * 32;
        const a = imageData[i+3];
        
        if (a < 128) continue;
        
        const key = `${r},${g},${b}`;
        colorCounts[key] = (colorCounts[key] || 0) + 1;
      }
      
      const sortedColors = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);
      
      const topKeys = sortedColors.slice(0, 3).map(k => k[0]);
      const hexColors = topKeys.map(k => {
        const [r, g, b] = k.split(',').map(Number);
        return `#${Math.min(255, r).toString(16).padStart(2, '0')}${Math.min(255, g).toString(16).padStart(2, '0')}${Math.min(255, b).toString(16).padStart(2, '0')}`;
      });
      
      // Ensure we return exactly 3 if possible
      resolve(hexColors);
    };
    img.onerror = () => resolve([]);
    img.src = `data:${mimeType};base64,${dataBase64}`;
  });
}
