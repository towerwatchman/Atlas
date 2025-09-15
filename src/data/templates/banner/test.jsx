const CustomBannerTemplate = ({ game, onSelect }) => {
  return React.createElement(
    'div',
    {
      className: 'relative w-[537px] h-[251px] border border-gray-700 cursor-pointer',
      onClick: onSelect
    },
    [
      // Top overlay with gradient
      React.createElement('div', {
        className: 'absolute top-0 left-0 w-full h-[26px] bg-gradient-to-r from-blue-900 to-blue-700 opacity-80 z-10'
      }),
      // Banner image
      React.createElement('img', {
        src: game.banner_url,
        alt: game.title,
        className: 'w-[537px] h-[251px] object-cover'
      }),
      // Bottom overlay with gradient
      React.createElement('div', {
        className: 'absolute bottom-0 left-0 w-full h-[26px] bg-gradient-to-r from-blue-900 to-blue-700 opacity-80 z-10'
      }),
      // Text and button elements
      React.createElement(
        'div',
        { className: 'absolute inset-0 z-20' },
        [
          // Engine and Creator at top-left with shadow
          React.createElement(
            'div',
            { className: 'absolute top-0 left-0' },
            [
              React.createElement('div', {
                className: 'text-white text-sm font-bold ml-3 mt-2 drop-shadow-md',
                children: game.engine || 'Unknown'
              }),
              React.createElement('div', {
                className: 'text-white text-sm ml-3 mt-1 drop-shadow-md',
                children: game.creator || 'Unknown'
              })
            ]
          ),
          // Update Available button at top-right
          game.isUpdateAvailable &&
            React.createElement(
              'button',
              {
                className: 'absolute top-0 right-0 w-[100px] h-[22px] bg-transparent border border-green-400 text-green-400 text-[11px] rounded-md m-1 hover:bg-green-400 hover:text-white',
                onClick: (e) => {
                  e.stopPropagation();
                  window.electronAPI.openExternalUrl(game.siteUrl);
                }
              },
              'Update Now!'
            ),
          // Status and LatestVersion at bottom-right
          React.createElement(
            'div',
            { className: 'absolute bottom-0 right-0 flex items-center mr-3 mb-2' },
            [
              React.createElement('div', {
                className: 'text-white text-[11px] bg-blue-800 rounded-l-md px-3 py-1',
                children: game.status || 'Completed'
              }),
              React.createElement('div', {
                className: 'text-white text-[11px] bg-blue-600 rounded-r-md px-3 py-1 -ml-0.5',
                children: game.latestVersion || 'V 1.0'
              })
            ]
          )
        ]
      )
    ]
  );
};

export default CustomBannerTemplate;