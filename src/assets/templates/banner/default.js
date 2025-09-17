const CustomBannerTemplate = ({ game, onSelect }) => {
  // Engine background color mapping based on C# DataTriggers
  const getEngineBackgroundColor = (engine) => {
    const engineColors = {
      'ADRIFT': '#4F68D9',
      'Flash': '#D04220',
      'HTML': '#5B8600',
      'Java': '#6EA4B1',
      'Others': '#72A200',
      'QSP': '#BD3631',
      'RAGS': '#B67E00',
      'RPGM': '#4F68D9',
      "Ren'Py": '#9B00EF',
      'Tads': '#4F68D9',
      'Unity': '#D35B00',
      'Unreal Engine': '#3730A9',
      'WebGL': '#E56200',
      'Wolf RPG': '#4B8926'
    };
    return engineColors[engine] || '#4B8926'; // Default to Wolf RPG color if unknown
  };

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

  // Inline CSS for hover effects
  const bannerStyles = `
    .banner-root {
      perspective: 1000px;
      transform-style: preserve-3d;
      transform: skewX(0.001deg);
      transition: transform 0.35s ease-in-out;
    }
    .banner-root:hover {
      transform: rotateX(7deg) translateY(-6px) scale(1.05);
      transition: transform 0.35s ease-in-out 0.1s;
    }
    .banner-root::before {
      content: '';
      position: absolute;
      z-index: -1;
      top: 5%;
      left: 5%;
      width: 90%;
      height: 90%;
      background: rgba(0,0,0,0.5);
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      transform-origin: top center;
      transform: skewX(0.001deg);
      transition: transform 0.35s ease-in-out 0.1s, opacity 0.5s ease-in-out 0.1s;
    }
    .banner-root:hover::before {
      opacity: 0.6;
      transform: rotateX(7deg) translateY(-6px) scale(1.05);
    }
  `;

  const children = [
    // Inline styles for hover effects
    React.createElement('style', { key: 'banner-styles' }, bannerStyles),
    // Top overlay
    React.createElement('div', {
      key: 'top-overlay',
      className: 'absolute top-0 left-0 w-full h-[28px] bg-gradient-to-r from-blue-900 to-blue-700 opacity-80 z-10'
    }),
    // Bottom overlay
    React.createElement('div', {
      key: 'bottom-overlay',
      className: 'absolute bottom-0 left-0 w-full h-[28px] bg-gradient-to-r from-blue-900 to-blue-700 opacity-80 z-10'
    }),
    // Text and button elements
    React.createElement(
      'div',
      { key: 'content-layer', className: 'absolute inset-0 z-20' },
      [
        // Engine and Creator at top-left with shadow
        React.createElement(
          'div',
          { key: 'top-left-content', className: 'absolute top-0 left-0 flex items-center h-[28px]' },
          [
            React.createElement('div', {
              key: 'engine',
              className: 'text-white text-[11px] rounded-md px-3 py-1 ml-3 drop-shadow-md',
              style: { backgroundColor: getEngineBackgroundColor(game.engine) },
              children: game.engine || 'Unknown'
            }),
            React.createElement('div', {
              key: 'creator',
              className: 'text-white text-sm ml-3 drop-shadow-md',
              children: game.creator || 'Unknown'
            })
          ]
        ),
        // Update Available button at top-right, vertically centered
        game.isUpdateAvailable &&
          React.createElement(
            'button',
            {
              key: 'update-button',
              className: 'absolute top-[4px] right-3 w-[100px] h-[22px] bg-transparent border border-green-400 text-green-400 text-[11px] rounded-md z-30 pointer-events-auto',
              onClick: (e) => {
                e.stopPropagation();
                console.log(`Attempting to open siteUrl: ${game.siteUrl}`);
                if (game.siteUrl && typeof game.siteUrl === 'string' && game.siteUrl.startsWith('http')) {
                  window.electronAPI.openExternalUrl(game.siteUrl);
                } else {
                  console.error(`Invalid siteUrl: ${game.siteUrl}`);
                }
              }
            },
            'Update Now!'
          ),
        // Status and LatestVersion at bottom-right
        React.createElement(
          'div',
          { key: 'bottom-right-content', className: 'absolute bottom-0 right-0 flex items-center mr-3 h-[28px]' },
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

  // Conditionally add banner image
  //we need to change this to banner
  if (game.banner_url) {
    children.splice(1, 0, React.createElement('div', {
      key: 'banner-image-container',
      className: 'absolute top-0 left-0 w-[537px] h-[251px] z-0 bg-[#1F2937]'
    }, [
      React.createElement('img', {
        src: game.banner_url,
        alt: game.title,
        className: 'w-[537px] h-[251px] object-cover'
      })
    ]));
  } else {
    // Fallback background when no image
    children.splice(1, 0, React.createElement('div', {
      key: 'banner-fallback',
      className: 'absolute top-0 left-0 w-[537px] h-[251px] bg-[#1F2937] z-0'
    }));
  }

  return React.createElement(
    'div',
    {
      className: 'relative w-[537px] h-[251px] border border-gray-700 cursor-pointer overflow-hidden banner-root',
      onClick: onSelect,
      //onMouseEnter: () => console.log(`Hover started on banner: ${game.title || 'Unknown'}`),
      //onMouseLeave: () => console.log(`Hover ended on banner: ${game.title || 'Unknown'}`)
    },
    children
  );
};

export default CustomBannerTemplate;