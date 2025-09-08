const GameBanner = ({ game, onSelect }) => {
  return React.createElement(
    'div',
    { className: 'cursor-pointer', onClick: onSelect },
    React.createElement('img', {
      src: game.banner_url || './data/images/placeholder.webp',
      alt: game.title,
      className: 'w-full h-48 object-cover rounded'
    }),
    React.createElement('h2', { className: 'text-lg font-semibold mt-2' }, game.title)
  );
};

window.GameBanner = GameBanner;