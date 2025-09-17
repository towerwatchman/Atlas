const { useState, useEffect } = window.React;

// Inline CSS for hover effects
const bannerStyles = `
  .banner-root {
    perspective: 1000px;
    transform-style: preserve-3d;
    transform: skewX(0.001deg);
    transition: transform 0.35s ease-in-out;
  }
  .banner-root:hover {
    transform: rotateX(7deg) translateY(-6px) scale(1.02);
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
    transform: rotateX(7deg) translateY(-6px) scale(1.02);
  }
`;

const GameBanner = ({ game, onSelect }) => {
  const [template, setTemplate] = useState(null);

  useEffect(() => {
    // Load the selected template from Appearance settings
    const loadTemplate = async () => {
      try {
        const selectedTemplate = await window.electronAPI.getSelectedBannerTemplate();
        if (selectedTemplate && selectedTemplate !== 'Default') {
          try {
            // Adjust path based on project structure
            const templateModule = await import(`./data/templates/banner/${selectedTemplate}.js`);
            setTemplate(() => templateModule.default);
          } catch (importErr) {
            console.error(`Failed to import template ${selectedTemplate}:`, importErr);
            window.electronAPI.log(`Failed to import template ${selectedTemplate}: ${importErr.message}`);
            setTemplate(() => DefaultBannerTemplate); // Fallback to default
          }
        } else {
          setTemplate(() => DefaultBannerTemplate);
        }
      } catch (err) {
        console.error('Error loading banner template:', err);
        window.electronAPI.log(`Error loading banner template: ${err.message}`);
        setTemplate(() => DefaultBannerTemplate); // Fallback to default
      }
    };
    loadTemplate();
  }, []);

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
    return engineColors[engine] || '#4B8926'; // Default to Wolf RPG color
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
    return statusColors[status] || 'transparent'; // Default to transparent
  };

  // Default template
  const DefaultBannerTemplate = ({ game, onSelect }) => {
    const children = [
      // Inline styles for hover effects
      React.createElement('style', { key: 'banner-styles' }, bannerStyles),
      // Top overlay
      React.createElement('div', {
        key: `top-overlay-${game.record_id}`,
        className: 'absolute top-0 left-0 w-full h-[28px] bg-black opacity-80 z-10'
      }),
      // Bottom overlay
      React.createElement('div', {
        key: `bottom-overlay-${game.record_id}`,
        className: 'absolute bottom-0 left-0 w-full h-[28px] bg-black opacity-80 z-10'
      }),
      // Text and button elements
      React.createElement(
        'div',
        { key: `content-layer-${game.record_id}`, className: 'absolute inset-0 z-20' },
        [
          // Creator in top-left of top overlay, vertically centered
          React.createElement('div', {
            key: `creator-${game.record_id}`,
            className: 'absolute top-0 left-0 text-white text-xs ml-2.5 flex items-center h-[28px]',
            children: game.creator || 'Unknown'
          }),
          // Update Available button at top-right, vertically centered
          game.isUpdateAvailable &&
            React.createElement(
              'button',
              {
                key: `update-button-${game.record_id}`,
                className: 'absolute top-[4px] right-2.5 w-[90px] h-[20px] bg-transparent border border-yellow-400 text-yellow-400 text-[10px] rounded-sm z-30 pointer-events-auto',
                onClick: (e) => {
                  e.stopPropagation();
                  if (game.siteUrl && typeof game.siteUrl === 'string' && game.siteUrl.startsWith('http')) {
                    window.electronAPI.openExternalUrl(game.siteUrl);
                  } else {
                    console.error(`Invalid siteUrl: ${game.siteUrl}`);
                  }
                }
              },
              'Update Available!'
            ),
          // Bottom overlay content
          React.createElement(
            'div',
            { key: `bottom-content-${game.record_id}`, className: 'absolute bottom-0 left-0 w-full h-[28px] flex items-center' },
            [
              // Engine at bottom-left with rounded background
              React.createElement('div', {
                key: `engine-${game.record_id}`,
                className: 'text-white text-[10px] rounded-sm px-2 py-0.5 ml-2',
                style: { backgroundColor: getEngineBackgroundColor(game.engine) },
                children: game.engine || 'Unknown'
              }),
              // Title centered in bottom overlay
              React.createElement('div', {
                key: `title-${game.record_id}`,
                className: 'text-white text-xs font-semibold flex-1 text-center',
                children: game.title || 'Unknown'
              }),
              // Status and LatestVersion at bottom-right
              React.createElement(
                'div',
                { key: `status-version-${game.record_id}`, className: 'flex items-center mr-2.5' },
                [
                  // Status (if present) to the left of version
                  game.status &&
                    React.createElement('div', {
                      key: `status-${game.record_id}`,
                      className: 'text-white text-[10px] rounded-l-sm px-2 py-0.5',
                      style: { backgroundColor: getStatusBackgroundColor(game.status) },
                      children: game.status
                    }),
                  // LatestVersion with fixed background color
                  React.createElement('div', {
                    key: `version-${game.record_id}`,
                    className: `text-white text-[10px] ${game.status ? 'rounded-r-sm -ml-0.5' : 'rounded-sm'} px-2 py-0.5`,
                    style: { backgroundColor: '#3F4043' },
                    children: game.latestVersion || 'V 1.0'
                  })
                ]
              )
            ]
          )
        ]
      )
    ];

    // Conditionally add banner image
    if (game.banner_url) {
      children.splice(1, 0, React.createElement('div', {
        key: `banner-image-container-${game.record_id}`,
        className: 'absolute top-0 left-0 w-[537px] h-[251px] z-0 bg-[#1F2937]'
      }, [
        React.createElement('img', {
          key: `banner-image-${game.record_id}`,
          src: game.banner_url,
          alt: game.title,
          className: 'w-[537px] h-[251px] object-contain'
        })
      ]));
    } else {
      // Fallback background when no image
      children.splice(1, 0, React.createElement('div', {
        key: `banner-fallback-${game.record_id}`,
        className: 'absolute top-0 left-0 w-[537px] h-[251px] bg-[#1F2937] z-0'
      }));
    }

    return React.createElement(
      'div',
      {
        key: `banner-root-${game.record_id}`,
        className: 'relative w-[537px] h-[251px] border border-black cursor-pointer overflow-hidden banner-root',
        onClick: onSelect
      },
      children
    );
  };

  if (!template) {
    return React.createElement('div', null, 'Loading template...');
  }

  return React.createElement(template, { game, onSelect });
};

window.GameBanner = GameBanner;