const CustomBannerTemplate = ({ game, onSelect }) => {
  // Status background color mapping based on C# Style.Triggers
  const getStatusBackgroundColor = (status) => {
    const statusColors = {
      'Completed': '#4F68D9',
      'Onhold': '#649DFC',
      'Abandoned': '#B67E00',
      '': 'transparent',
      null: 'transparent'
    };
    return statusColors[status] || 'transparent'; // Default to transparent if unknown
  };

  const children = [
    // Top overlay with gradient
    React.createElement('div', {
      key: 'top-overlay',
      className: 'absolute top-0 left-0 w-full h-[26px] bg-gradient-to-r from-blue-900 to-blue-700 opacity-80 z-10 flex items-center'
    }, [
      // Update Available button at top-right, vertically centered
      game.isUpdateAvailable &&
        React.createElement(
          'button',
          {
            key: 'update-button',
            className: 'absolute right-0 w-[100px] h-[22px] bg-transparent border border-green-400 text-green-400 text-[11px] rounded-md mr-3 z-30',
            onClick: (e) => {
              e.stopPropagation();
              console.log(`Opening siteUrl: ${game.siteUrl}`); // Debug log
              window.electronAPI.openExternalUrl(game.siteUrl);
            }
          },
          'Update Now!'
        )
    ]),
    // Bottom overlay with gradient
    React.createElement('div', {
      key: 'bottom-overlay',
      className: 'absolute bottom-0 left-0 w-full h-[26px] bg-gradient-to-r from-blue-900 to-blue-700 opacity-80 z-10'
    }),
    // Text and button elements
    React.createElement(
      'div',
      { key: 'content-layer', className: 'absolute inset-0 z-20' },
      [
        // Engine and Creator at top-left with shadow
        React.createElement(
          'div',
          { key: 'top-left-content', className: 'absolute top-0 left-0' },
          [
            React.createElement('div', {
              key: 'engine',
              className: 'text-white text-sm font-bold ml-3 mt-2 drop-shadow-md',
              children: game.engine || 'Unknown'
            }),
            React.createElement('div', {
              key: 'creator',
              className: 'text-white text-sm ml-3 mt-1 drop-shadow-md',
              children: game.creator || 'Unknown'
            })
          ]
        ),
        // Status and LatestVersion at bottom-right
        React.createElement(
          'div',
          { key: 'bottom-right-content', className: 'absolute bottom-0 right-0 flex items-center mr-3 mb-2' },
          [
            // Status (if present) to the left of version
            game.status &&
              React.createElement('div', {
                key: 'status',
                className: 'text-white text-[11px] rounded-l-md px-3 py-1',
                style: { backgroundColor: getStatusBackgroundColor(game.status) },
                children: game.status
              }),
            // LatestVersion with fixed background color
            React.createElement('div', {
              key: 'version',
              className: `text-white text-[11px] ${game.status ? 'rounded-r-md -ml-0.5' : 'rounded-md'} px-3 py-1`,
              style: { backgroundColor: '#3F4043' },
              children: game.latestVersion || 'V 1.0'
            })
          ]
        )
      ]
    )
  ];

  // Conditionally add banner image if banner_url exists
  if (game.banner_url) {
    children.splice(1, 0, React.createElement('img', {
      key: 'banner-image',
      src: game.banner_url,
      alt: game.title,
      className: 'w-[537px] h-[251px] object-cover'
    }));
  }

  return React.createElement(
    'div',
    {
      className: 'relative w-[537px] h-[251px] border border-gray-700 cursor-pointer overflow-hidden',
      onClick: onSelect
    },
    children
  );
};

export default CustomBannerTemplate;