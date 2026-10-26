# GlobalVest hero illustration — asset generation prompt

Use this prompt to regenerate desktop (16:9) and mobile (9:16) hero backgrounds if needed.

## Desktop (1920 × 1080)

Photorealistic, ultra-detailed, cinematic 3D fintech illustration for a premium digital banking and cryptocurrency website.

Include:

1. Realistic black smartphone, diagonal left, futuristic dashboard with glowing green charts and crypto portfolio UI.
2. Large metallic security shield behind the phone with bright neon-green padlock.
3. Premium black GlobalVest banking card on the right.
4. Gold Bitcoin coins stacked near center.
5. Ethereum and Tether coins.
6. Glowing digital Earth with green international connection lines.
7. Dark glossy volcanic rocks.
8. Emerald-green reflections and cinematic lighting.
9. Deep black atmosphere (#030B09).

**Do not include:** website buttons, headings, navigation, or random text.

Save as: `public/images/globalvest-finance-desktop.webp` (or `.jpg`).

## Mobile (1080 × 1600)

Same scene, portrait crop — phone, shield, coins, and card must remain visible with negative space for responsive cropping.

Save as: `public/images/globalvest-finance-mobile.webp` (or `.jpg`).

## Integration

The landing page (`index.html`) loads these via `<picture>`:

- Desktop: `public/images/globalvest-finance-desktop.jpg`
- Mobile: `public/images/globalvest-finance-mobile.jpg`

Replace files without changing HTML if paths stay the same.
