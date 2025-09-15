const { useState, useEffect } = window.React;

const GameBanner = ({ game, onSelect }) => {
  const [template, setTemplate] = useState(null);

  useEffect(() => {
    // Load the selected template from Appearance settings
    const loadTemplate = async () => {
      try {
        const selectedTemplate = await window.electronAPI.getSelectedBannerTemplate();
        if (selectedTemplate && selectedTemplate !== 'Default') {
          // Dynamically import the template JS file from data/templates/banner
          const templateModule = await import(`../../data/templates/banner/${selectedTemplate}.js`);
          setTemplate(() => templateModule.default);
        } else {
          // Use default template
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

  // Default template with fixed update button
  const DefaultBannerTemplate = ({ game, onSelect }) => {
    const children = [
      // Top overlay
      React.createElement('div', {
        key: 'top-overlay',
        className: 'absolute top-0 left-0 w-full h-[26px] bg-black opacity-80 z-10 flex items-center'
      }, [
        // Update Available button at top-right, vertically centered
        game.isUpdateAvailable &&
          React.createElement(
            'button',
            {
              key: 'update-button',
              className: 'absolute right-0 w-[90px] h-[20px] bg-transparent border border-yellow-400 text-yellow-400 text-[10px] rounded-sm mr-2.5 z-30',
              onClick: (e) => {
                e.stopPropagation();
                console.log(`Opening siteUrl: ${game.siteUrl}`); // Debug log
                window.electronAPI.openExternalUrl(game.siteUrl);
              }
            },
            'Update Available!'
          )
      ]),
      // Bottom overlay
      React.createElement('div', {
        key: 'bottom-overlay',
        className: 'absolute bottom-0 left-0 w-full h-[26px] bg-black opacity-80 z-10'
      }),
      // Text and button elements
      React.createElement(
        'div',
        { key: 'content-layer', className: 'absolute inset-0 z-20' },
        [
          // Creator in top-left of top overlay
          React.createElement('div', {
            key: 'creator',
            className: 'absolute top-0 left-0 text-white text-xs ml-2.5 mt-1.5',
            children: game.creator || 'Unknown'
          }),
          // Bottom overlay content
          React.createElement(
            'div',
            { key: 'bottom-content', className: 'absolute bottom-0 left-0 w-full h-[26px] flex items-center' },
            [
              // Engine at bottom-left with rounded background
              React.createElement('div', {
                key: 'engine',
                className: 'text-white text-[10px] rounded-sm px-2 py-0.5 ml-2',
                style: { backgroundColor: getEngineBackgroundColor(game.engine) },
                children: game.engine || 'Unknown'
              }),
              // Title centered in bottom overlay
              React.createElement('div', {
                key: 'title',
                className: 'text-white text-xs font-semibold flex-1 text-center',
                children: game.title || 'Unknown'
              }),
              // Status and LatestVersion at bottom-right
              React.createElement(
                'div',
                { key: 'status-version', className: 'flex items-center mr-2.5' },
                [
                  // Status (if present) to the left of version
                  game.status &&
                    React.createElement('div', {
                      key: 'status',
                      className: 'text-white text-[10px] rounded-l-sm px-2 py-0.5',
                      style: { backgroundColor: getStatusBackgroundColor(game.status) },
                      children: game.status
                    }),
                  // LatestVersion with fixed background color
                  React.createElement('div', {
                    key: 'version',
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

    // Conditionally add banner image if banner_url exists
    if (game.banner_url) {
      children.splice(1, 0, React.createElement('img', {
        key: 'banner-image',
        src: game.banner_url,
        alt: game.title,
        className: 'w-[537px] h-[251px] object-contain'
      }));
    }

    return React.createElement(
      'div',
      {
        className: 'relative w-[537px] h-[251px] border border-black cursor-pointer overflow-hidden',
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