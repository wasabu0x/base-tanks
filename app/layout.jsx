import "./globals.css";

const SITE = "https://base-tanks.vercel.app";

const frame = {
  version: "1",
  imageUrl: `${SITE}/hero.png`,
  button: {
    title: "▶ Play Base Tanks",
    action: {
      type: "launch_frame",
      name: "Base Tanks",
      url: SITE,
      splashImageUrl: `${SITE}/splash.png`,
      splashBackgroundColor: "#0a0e27",
    },
  },
};

export const metadata = {
  title: "Base Tanks — On-chain Battle City",
  description: "Classic Battle City tanks on Base. Pay 0.1$ to start a level.",
  openGraph: {
    title: "Base Tanks",
    description: "Classic Battle City tanks on Base. Pay 0.1$ to start a level.",
    images: [`${SITE}/hero.png`],
  },
  other: {
    "fc:miniapp": JSON.stringify(frame),
    "fc:frame": JSON.stringify(frame),
    // Base.dev domain ownership verification
    "base:app_id": "69fd7fd8de35bbe9eac4ac9e",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
