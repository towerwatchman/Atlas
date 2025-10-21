const F95BannerTemplate = ({ game, onSelect }) => {
  // Engine background color mapping based on C# DataTriggers
  const getEngineBackgroundColor = (engine) => {
    const engineColors = {
      ADRIFT: "#4F68D9",
      Flash: "#D04220",
      HTML: "#5B8600",
      Java: "#6EA4B1",
      Others: "#72A200",
      QSP: "#BD3631",
      RAGS: "#B67E00",
      RPGM: "#4F68D9",
      "Ren'Py": "#9B00EF",
      Tads: "#4F68D9",
      Unity: "#D35B00",
      "Unreal Engine": "#3730A9",
      WebGL: "#E56200",
      "Wolf RPG": "#4B8926",
    };
    return engineColors[engine] || "#4B8926"; // Default to Wolf RPG color
  };

  // Status background color mapping based on C# Style.Triggers
  const getStatusBackgroundColor = (status) => {
    const statusColors = {
      Completed: "#4F68D9",
      Onhold: "#649DFC",
      Abandoned: "#B67E00",
      "": "transparent",
      null: "transparent",
    };
    return statusColors[status] || "transparent"; // Default to transparent
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
    React.createElement("style", { key: "banner-styles" }, bannerStyles),
    // Thumbnail
    game.banner_url &&
      React.createElement(
        "div",
        {
          key: "thumbnail",
          className: "w-full h-[300px] bg-[#1F2937]",
        },
        [
          React.createElement("img", {
            src: game.banner_url,
            alt: game.title,
            className: "w-full h-full object-cover",
          }),
        ],
      ),
    // Fallback background when no image
    !game.banner_url &&
      React.createElement("div", {
        key: "thumbnail-fallback",
        className: "w-full h-[300px] bg-[#1F2937]",
      }),
    // Body
    React.createElement(
      "div",
      {
        key: "body",
        className: "relative w-full bg-[#1F2937] p-2 flex flex-col",
      },
      [
        // Labels
        React.createElement(
          "div",
          { key: "label-wrap", className: "flex justify-between mb-2" },
          [
            // Engine (left)
            React.createElement("div", {
              key: "engine",
              className: "text-white text-[10px] rounded-sm px-2 py-0.5",
              style: { backgroundColor: getEngineBackgroundColor(game.engine) },
              children: game.engine || "Unknown",
            }),
            // Status and Version (right)
            React.createElement(
              "div",
              { key: "status-version", className: "flex items-center" },
              [
                game.status &&
                  React.createElement("div", {
                    key: "status",
                    className:
                      "text-white text-[10px] rounded-l-sm px-2 py-0.5",
                    style: {
                      backgroundColor: getStatusBackgroundColor(game.status),
                    },
                    children: game.status,
                  }),
                React.createElement("div", {
                  key: "version",
                  className: `text-white text-[10px] ${game.status ? "rounded-r-sm -ml-0.5" : "rounded-sm"} px-2 py-0.5`,
                  style: { backgroundColor: "#3F4043" },
                  children: game.latestVersion || "V 1.0",
                }),
              ],
            ),
          ],
        ),
        // Info section
        React.createElement(
          "div",
          { key: "info", className: "flex flex-col" },
          [
            // Header
            React.createElement(
              "header",
              { key: "header", className: "flex flex-col" },
              [
                React.createElement(
                  "div",
                  {
                    key: "header-title",
                    className: "flex justify-between items-center",
                  },
                  [
                    React.createElement("h2", {
                      className: "text-white text-sm font-semibold truncate",
                      style: { textOverflow: "ellipsis" },
                      children: game.title || "Unknown",
                    }),
                    React.createElement("div", {
                      className: "text-white text-xs",
                      children: game.latestVersion || "V 1.0",
                    }),
                  ],
                ),
                React.createElement("div", {
                  key: "creator",
                  className: "text-white text-xs mt-1",
                  children: [
                    React.createElement("span", {
                      className: "fas fa-user mr-1",
                    }),
                    game.creator || "Unknown",
                  ],
                }),
              ],
            ),
            // Meta stats
            React.createElement(
              "div",
              { key: "meta", className: "flex gap-2 mt-2 text-white text-xs" },
              [
                React.createElement("div", {
                  key: "views",
                  children: `${game.views || 0} Views`,
                }),
                React.createElement("div", {
                  key: "likes",
                  children: `${game.likes || 0} Likes`,
                }),
                React.createElement("div", {
                  key: "rating",
                  children: game.rating || "-",
                }),
              ],
            ),
          ],
        ),
        // Update Available button
        game.isUpdateAvailable &&
          React.createElement(
            "button",
            {
              key: "update-button",
              className:
                "absolute top-2 right-2 w-[90px] h-[20px] bg-transparent border border-yellow-400 text-yellow-400 text-[10px] rounded-sm z-30 pointer-events-auto",
              onClick: (e) => {
                e.stopPropagation();
                console.log(`Attempting to open siteUrl: ${game.siteUrl}`);
                if (
                  game.siteUrl &&
                  typeof game.siteUrl === "string" &&
                  game.siteUrl.startsWith("http")
                ) {
                  window.electronAPI.openExternalUrl(game.siteUrl);
                } else {
                  console.error(`Invalid siteUrl: ${game.siteUrl}`);
                }
              },
            },
            "Update Available!",
          ),
      ],
    ),
  ];

  return React.createElement(
    "div",
    {
      className:
        "relative w-[300px] h-[450px] border border-black cursor-pointer overflow-hidden banner-root",
      onClick: onSelect,
      //onMouseEnter: () => console.log(`Hover started on banner: ${game.title || 'Unknown'}`),
      //onMouseLeave: () => console.log(`Hover ended on banner: ${game.title || 'Unknown'}`)
    },
    children,
  );
};

export default F95BannerTemplate;
