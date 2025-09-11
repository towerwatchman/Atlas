const GameBanner = ({ game, onSelect }) => {
  if (!game.banner_url) return null;
  return React.createElement(
    'div',
    { className: 'cursor-pointer w-[520px] h-[250px] relative border border-black', onClick: onSelect },
    [
      React.createElement('div', {
        className: 'absolute top-0 h-[26px] w-full bg-overlayTopColor bg-opacity-80'
      }),
      React.createElement('img', {
        src: `${game.banner_url}`,
        alt: game.title,
        className: 'w-[520px] h-[250px] object-contain'
      }),
      React.createElement('div', {
        className: 'absolute bottom-0 h-[26px] w-full bg-overlayTopColor bg-opacity-80'
      }),
    ]
  );
};

window.GameBanner = GameBanner;