const GameDetails = ({ game, onRemove }) => {
  return React.createElement(
    "div",
    { className: "bg-[var(--secondary)] p-4 rounded" },
    React.createElement("h2", { className: "text-2xl font-bold" }, game.title),
    React.createElement("p", null, game.description),
    React.createElement(
      "p",
      null,
      React.createElement("strong", null, "Tags: "),
      game.tags,
    ),
    React.createElement(
      "p",
      null,
      React.createElement("strong", null, "Path: "),
      game.path,
    ),
    React.createElement(
      "button",
      {
        className:
          "bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded mt-2",
        onClick: onRemove,
      },
      "Remove Game",
    ),
  );
};

window.GameDetails = GameDetails;
