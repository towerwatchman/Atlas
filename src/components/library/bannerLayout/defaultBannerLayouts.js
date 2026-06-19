export const defaultBannerLayouts = [
  {
    id: 'classic',
    name: 'Classic',
    width: 537,
    height: 251,
    imageFit: 'contain',
    hoverEffect: 'classic-tilt',
    overlays: {
      top: { visible: true, opacity: 0.8 },
      bottom: { visible: true, opacity: 0.8 },
    },
    fields: [
      { id: 'creator', slot: 'top-left', visible: true, fontSize: 12 },
      { id: 'update', slot: 'top-right', visible: true, fontSize: 10 },
      { id: 'engine', slot: 'bottom-left', visible: true, fontSize: 10, badge: true },
      { id: 'title', slot: 'bottom-center', visible: true, fontSize: 12 },
      { id: 'status', slot: 'bottom-right', visible: true, fontSize: 10, badge: true },
      { id: 'version', slot: 'bottom-right', visible: true, fontSize: 10, badge: true },
      { id: 'favorite', slot: 'top-left-floating', visible: true },
      { id: 'wishlist', slot: 'top-right-floating', visible: true },
    ],
  },
  {
    id: 'clean-art',
    name: 'Clean Art',
    width: 537,
    height: 251,
    imageFit: 'cover',
    hoverEffect: 'classic-tilt',
    overlays: {
      top: { visible: false, opacity: 0 },
      bottom: { visible: true, opacity: 0.35 },
    },
    fields: [
      { id: 'title', slot: 'bottom-left', visible: true, fontSize: 13 },
      { id: 'version', slot: 'bottom-right', visible: true, fontSize: 10, badge: true },
      { id: 'favorite', slot: 'top-left-floating', visible: true },
      { id: 'wishlist', slot: 'top-right-floating', visible: true },
    ],
  },
  {
    id: 'metadata-heavy',
    name: 'Metadata Heavy',
    width: 537,
    height: 251,
    imageFit: 'contain',
    hoverEffect: 'classic-tilt',
    overlays: {
      top: { visible: true, opacity: 0.85 },
      bottom: { visible: true, opacity: 0.85 },
    },
    fields: [
      { id: 'creator', slot: 'top-left', visible: true, fontSize: 12 },
      { id: 'update', slot: 'top-right', visible: true, fontSize: 10 },
      { id: 'title', slot: 'center', visible: true, fontSize: 14 },
      { id: 'engine', slot: 'bottom-left', visible: true, fontSize: 10, badge: true },
      { id: 'status', slot: 'bottom-center', visible: true, fontSize: 10, badge: true },
      { id: 'version', slot: 'bottom-right', visible: true, fontSize: 10, badge: true },
      { id: 'favorite', slot: 'top-left-floating', visible: true },
      { id: 'wishlist', slot: 'top-right-floating', visible: true },
    ],
  },
]

export const getBuiltInBannerLayoutOptions = () =>
  defaultBannerLayouts.map(({ id, name }) => ({ id, name }))

