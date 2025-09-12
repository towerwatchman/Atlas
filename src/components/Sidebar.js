const Sidebar = () => {
  const [selected, setSelected] = React.useState('Home');

  const items = [
    { 
      name: 'Home', 
      icon: 'home.svg', 
      path: ['<path d="M12 2 A 1 1 0 0 0 11.289062 2.296875L1.203125 11.097656 A 0.5 0.5 0 0 0 1 11.5 A 0.5 0.5 0 0 0 1.5 12L4 12L4 20C4 20.552 4.448 21 5 21L9 21C9.552 21 10 20.552 10 20L10 14L14 14L14 20C14 20.552 14.448 21 15 21L19 21C19.552 21 20 20.552 20 20L20 12L22.5 12 A 0.5 0.5 0 0 0 23 11.5 A 0.5 0.5 0 0 0 22.796875 11.097656L12.716797 2.3027344 A 1 1 0 0 0 12.710938 2.296875 A 1 1 0 0 0 12 2 z"/>'],
      viewBox: '0 0 24 22'
    },
    { 
      name: 'Add', 
      icon: 'add.svg', 
      path: [
        '<path d="M11 8C11 7.44772 11.4477 7 12 7C12.5523 7 13 7.44771 13 8V11H16C16.5523 11 17 11.4477 17 12C17 12.5523 16.5523 13 16 13H13V16C13 16.5523 12.5523 17 12 17C11.4477 17 11 16.5523 11 16V13H8C7.44772 13 7 12.5523 7 12C7 11.4477 7.44771 11 8 11H11V8Z"/>',
        '<rect x="1" y="1" width="22" height="22" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/>'
      ],
      viewBox: '0 0 24 24'
    },
    { 
      name: 'List', 
      icon: 'mygames.svg', 
      path: ['<path d="M6 5C4.894531 5 4 5.894531 4 7C4 8.105469 4.894531 9 6 9C7.105469 9 8 8.105469 8 7C8 5.894531 7.105469 5 6 5 Z M 11 6L11 8L28 8L28 6 Z M 6 14C4.894531 14 4 14.894531 4 16C4 17.105469 4.894531 18 6 18C7.105469 18 8 17.105469 8 16C8 14.894531 7.105469 14 6 14 Z M 11 15L11 17L28 17L28 15 Z M 6 23C4.894531 23 4 23.894531 4 25C4 26.105469 4.894531 27 6 27C7.105469 27 8 26.105469 8 25C8 23.894531 7.105469 23 6 23 Z M 11 24L11 26L28 26L28 24Z"/>'],
      viewBox: '0 0 28 28'
    },
    { 
      name: 'Updates', 
      icon: 'updates.svg', 
      path: ['<path d="M5,12A7,7,0,0,1,16.89,7H14a1,1,0,0,0,0,2h5.08A1,1,0,0,0,20,8V3a1,1,0,0,0-2,0V5.32A9,9,0,0,0,3,12a1,1,0,0,0,2,0Z M20,11a1,1,0,0,0-1,1A7,7,0,0,1,7.11,17H10a1,1,0,0,0,0-2H4.92A1,1,0,0,0,4,16v5a1,1,0,0,0,2,0V18.68A9,9,0,0,0,21,12,1,1,0,0,0,20,11Z"/>'],
      viewBox: '0 0 24 24'
    },
    { 
      name: 'Settings', 
      icon: 'settings.svg', 
      path: ['<path d="M10.490234 2C10.011234 2 9.6017656 2.3385938 9.5097656 2.8085938L9.1757812 4.5234375C8.3550224 4.8338012 7.5961042 5.2674041 6.9296875 5.8144531L5.2851562 5.2480469C4.8321563 5.0920469 4.33375 5.2793594 4.09375 5.6933594L2.5859375 8.3066406C2.3469375 8.7216406 2.4339219 9.2485 2.7949219 9.5625L4.1132812 10.708984C4.0447181 11.130337 4 11.559284 4 12C4 12.440716 4.0447181 12.869663 4.1132812 13.291016L2.7949219 14.4375C2.4339219 14.7515 2.3469375 15.278359 2.5859375 15.693359L4.09375 18.306641C4.33275 18.721641 4.8321562 18.908906 5.2851562 18.753906L6.9296875 18.1875C7.5958842 18.734206 8.3553934 19.166339 9.1757812 19.476562L9.5097656 21.191406C9.6017656 21.661406 10.011234 22 10.490234 22L13.509766 22C13.988766 22 14.398234 21.661406 14.490234 21.191406L14.824219 19.476562C15.644978 19.166199 16.403896 18.732596 17.070312 18.185547L18.714844 18.751953C19.167844 18.907953 19.66625 18.721641 19.90625 18.306641L21.414062 15.691406C21.653063 15.276406 21.566078 14.7515 21.205078 14.4375L19.886719 13.291016C19.955282 12.869663 20 12.440716 20 12C20 11.559284 19.955282 11.130337 19.886719 10.708984L21.205078 9.5625C21.566078 9.2485 21.653063 8.7216406 21.414062 8.3066406L19.90625 5.6933594C19.66725 5.2783594 19.167844 5.0910937 18.714844 5.2460938L17.070312 5.8125C16.404116 5.2657937 15.644607 4.8336609 14.824219 4.5234375L14.490234 2.8085938C14.398234 2.3385937 13.988766 2 13.509766 2L10.490234 2 z M 12 8C14.209 8 16 9.791 16 12C16 14.209 14.209 16 12 16C9.791 16 8 14.209 8 12C8 9.791 9.791 8 12 8 z"/>'],
      viewBox: '0 0 24 22'
    }
  ];

  return React.createElement(
    'div',
    { className: 'w-[60px] bg-primary flex flex-col items-center min-w-[60px] py-[1px]' },
    items.map((item) =>
      React.createElement(
        'div',
        {
          key: item.name,
          className: `w-full h-[60px] flex items-center justify-center relative cursor-pointer group`,
          onClick: () => {
            setSelected(item.name);
            if (item.name === 'Settings') {
              window.electronAPI.openSettings();
            }
          }
        },
        React.createElement('div', {
          className: `absolute left-0 w-[3px] h-full bg-accent transition-opacity opacity-0 group-hover:opacity-100`
        }),
        React.createElement(
          'svg',
          {
            className: `w-6 h-6 ${selected === item.name ? 'text-accent' : 'text-border'}`,
            viewBox: item.viewBox
          },
          item.path.map((pathStr, index) => {
            if (item.name === 'Add' && index === 1) {
              const rectMatch = pathStr.match(/<rect\s+x="([^"]*)"\s+y="([^"]*)"\s+width="([^"]*)"\s+height="([^"]*)"\s+rx="([^"]*)"\s+ry="([^"]*)"\s+fill="([^"]*)"\s+stroke="([^"]*)"\s+stroke-width="([^"]*)"/);
              return React.createElement('rect', {
                key: index,
                x: rectMatch[1],
                y: rectMatch[2],
                width: rectMatch[3],
                height: rectMatch[4],
                rx: rectMatch[5],
                ry: rectMatch[6],
                fill: rectMatch[7],
                stroke: rectMatch[8],
                strokeWidth: rectMatch[9]
              });
            }
            return React.createElement('path', {
              key: index,
              fill: 'currentColor',
              d: pathStr.match(/d="([^"]*)"/)[1]
            });
          })
        )
      )
    )
  );
};

window.Sidebar = Sidebar;