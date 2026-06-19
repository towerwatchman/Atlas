import BannerLayoutRenderer from '../../library/bannerLayout/BannerLayoutRenderer.jsx'

const BannerEditorPreview = ({ game, layout }) => (
  <div className="origin-top-left scale-[0.72] -mb-16">
    <BannerLayoutRenderer
      game={game}
      layout={layout}
      onSelect={() => {}}
      onContextMenu={(event) => event.preventDefault()}
    />
  </div>
)

export default BannerEditorPreview

