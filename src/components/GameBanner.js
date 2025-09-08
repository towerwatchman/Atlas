const GameBanner = ({ game, onSelect }) => {
  if (!game.banner_url) return null;
  return React.createElement(
    'div',
    { className: 'cursor-pointer w-[537px] h-[251px] relative', onClick: onSelect },
    [
      React.createElement('img', {
        src: `./${game.banner_url}`,
        alt: game.title,
        className: 'w-[537px] h-[251px] object-contain rounded'
      }),
      React.createElement('h2', {
        className: 'absolute bottom-2 left-2 text-lg font-semibold text-[var(--text)] bg-[var(--primary)] bg-opacity-75 px-2 py-1 rounded'
      }, game.title)
    ]
  );
};

window.GameBanner = GameBanner;