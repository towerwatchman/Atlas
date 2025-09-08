const Sidebar = () => {
  const [selected, setSelected] = React.useState('Home');

  const items = [
    { name: 'Home', icon: 'fa-home' },
    { name: 'Import', icon: 'fa-file-import' },
    { name: 'ShowList', icon: 'fa-list' },
    { name: 'Refresh', icon: 'fa-sync' },
    { name: 'Settings', icon: 'fa-cog' }
  ];

  return React.createElement(
    'div',
    { className: 'w-[60px] mt-[70px] bg-[var(--primary)] flex flex-col items-center py-4' },
    items.map((item) =>
      React.createElement(
        'div',
        {
          key: item.name,
          className: `w-full h-[60px] flex items-center justify-center relative cursor-pointer hover:bg-[var(--accent)] ${
            selected === item.name ? 'bg-[var(--accent)]' : ''
          }`,
          onClick: () => setSelected(item.name)
        },
        React.createElement('div', {
          className: `absolute left-0 w-1 h-full bg-[var(--accent)] ${
            selected === item.name ? 'opacity-100' : 'opacity-0'
          } hover:opacity-100 transition-opacity`
        }),
        React.createElement('i', {
          className: `fas ${item.icon} w-6 h-6 text-[var(--text)]`
        })
      )
    )
  );
};

window.Sidebar = Sidebar;