export const defaultBannerLayouts = [
  {
    id: 'classic',
    name: 'Classic',
    width: 537,
    height: 251,
    density: 'comfortable',
    imageFit: 'contain',
    image: { visible: true, fit: 'contain', position: 'center', fallbackBackground: 'dark' },
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
    density: 'comfortable',
    imageFit: 'cover',
    image: { visible: true, fit: 'cover', position: 'center', fallbackBackground: 'dark' },
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
    "id": "f95",
    "name": "F95",
    "width": 390,
    "height": 104,
    "density": "comfortable",
    "image": {
      "visible": true,
      "fit": "cover",
      "foregroundFit": "contain",
      "position": "center",
      "fallbackBackground": "dark",
      "backgroundMode": "image",
      "blurBackground": {
        "opacity": 0.6,
        "blur": 20,
        "scale": 1.1
      }
    },
    "imageFit": "cover",
    "hoverEffect": "zoom",
    "hoverScale": 1.02,
    "shadow": {
      "enabled": true,
      "color": "rgba(0,0,0,0.5)"
    },
    "iconColor": "#ca4949",
    "overlays": {
      "top": {
        "visible": false,
        "opacity": 0
      },
      "bottom": {
        "visible": false,
        "opacity": 0
      }
    },
    "panels": {
      "bottom": {
        "enabled": true,
        "size": 89,
        "background": "#232629",
        "textColor": "#f3f4f6",
        "padding": 14,
        "gap": 2,
        "border": {
          "width": 2,
          "color": "#BA4545",
          "top": true,
          "right": false,
          "bottom": false,
          "left": false
        }
      }
    },
    "border": {
      "width": 0,
      "color": "#000000",
      "radius": 5
    },
    "fields": [
      { "id": "creator", "slot": "top-left", "visible": false },
      {
        "id": "update",
        "slot": "top-right",
        "region": "image",
        "visible": true,
        "fontSize": 10,
        "hideWhenEmpty": true,
        "conditions": {
          "updateOnly": true
        }
      },
      {
        "id": "engine",
        "slot": "bottom-left",
        "region": "image",
        "visible": true,
        "badge": true,
        "fontSize": 12,
        "offsetY": 13,
        "textShadow": true,
        "bold": true
      },
      {
        "id": "title",
        "slot": "bottom-center",
        "region": "bottom",
        "row": 0,
        "visible": true,
        "bold": true,
        "fontSize": 16
      },
      {
        "id": "status",
        "slot": "bottom-right",
        "region": "image",
        "visible": true,
        "badge": true,
        "fontSize": 12,
        "offsetY": 13,
        "textShadow": true,
        "bold": true,
        "hideWhenEmpty": true
      },
      {
        "id": "version",
        "slot": "bottom-right",
        "region": "image",
        "visible": true,
        "badge": true,
        "fontSize": 12,
        "offsetY": 13,
        "textShadow": true,
        "bold": true
      },
      {
        "id": "favorite",
        "slot": "top-left-floating",
        "region": "image",
        "visible": true
      },
      {
        "id": "wishlist",
        "slot": "top-right-floating",
        "region": "image",
        "visible": true
      },
      {
        "id": "lastUpdated",
        "region": "bottom",
        "row": 1,
        "order": 0,
        "visible": true,
        "fontSize": 14,
        "iconScale": 1.2,
        "textColor": "#c7c7c7"
      },
      {
        "id": "likes",
        "region": "bottom",
        "row": 1,
        "order": 1,
        "offsetX": 2,
        "visible": true,
        "fontSize": 14,
        "iconScale": 1.2,
        "textColor": "#c7c7c7"
      },
      {
        "id": "views",
        "region": "bottom",
        "row": 1,
        "order": 2,
        "offsetX": 4,
        "visible": true,
        "fontSize": 14,
        "iconScale": 1.2,
        "textColor": "#c7c7c7"
      },
      {
        "id": "sourceRating",
        "slot": "bottom-right",
        "region": "bottom",
        "row": 1,
        "order": 3,
        "offsetX": 6,
        "visible": true,
        "fontSize": 14,
        "iconScale": 1.2,
        "textColor": "#c7c7c7"
      }
    ]
  },
  {
    "id": "lc",
    "name": "LC",
    "width": 350,
    "height": 200,
    "density": "comfortable",
    "image": {
      "visible": true,
      "fit": "cover",
      "foregroundFit": "contain",
      "position": "center",
      "dimWhenMissing": false,
      "fallbackBackground": "dark",
      "backgroundMode": "image",
      "blurBackground": {
        "opacity": 0.6,
        "blur": 20,
        "scale": 1.1
      }
    },
    "imageFit": "cover",
    "previewCycle": {
      "enabled": false,
      "intervalMs": 2000
    },
    "hoverEffect": "zoom",
    "hoverScale": 1.02,
    "shadow": {
      "enabled": true,
      "color": "rgba(0,0,0,0.5)"
    },
    "iconColor": "#ca4949",
    "overlays": {
      "top": {
        "visible": false,
        "opacity": 0
      },
      "bottom": {
        "visible": false,
        "opacity": 0
      }
    },
    "panels": {
      "top": {
        "enabled": false,
        "size": 0,
        "background": "#0e1116",
        "textColor": "#ffffff",
        "padding": 10,
        "gap": 6,
        "border": {
          "width": 0,
          "color": "#000000",
          "top": false,
          "right": false,
          "bottom": false,
          "left": false
        }
      },
      "right": {
        "enabled": false,
        "size": 150,
        "background": "#0e1116",
        "textColor": "#ffffff",
        "padding": 10,
        "gap": 6,
        "border": {
          "width": 0,
          "color": "#000000",
          "top": false,
          "right": false,
          "bottom": false,
          "left": false
        }
      },
      "bottom": {
        "enabled": true,
        "size": 180,
        "background": "#141A22",
        "textColor": "#f3f4f6",
        "padding": 14,
        "gap": 2,
        "border": {
          "width": 2,
          "color": "#22272F",
          "top": true,
          "right": false,
          "bottom": false,
          "left": false
        }
      },
      "left": {
        "enabled": false,
        "size": 0,
        "background": "#0e1116",
        "textColor": "#ffffff",
        "padding": 10,
        "gap": 6,
        "border": {
          "width": 0,
          "color": "#000000",
          "top": false,
          "right": false,
          "bottom": false,
          "left": false
        }
      }
    },
    "border": {
      "width": 0,
      "color": "#000000",
      "radius": 5
    },
    "fields": [
      {
        "id": "creator",
        "slot": "top-left",
        "region": "bottom",
        "row": 2,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "#a3a3a3",
        "iconScale": 1,
        "visible": true,
        "fontSize": 12,
        "badge": false,
        "hideWhenEmpty": false,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "update",
        "slot": "top-right",
        "region": "image",
        "row": 0,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "",
        "iconScale": 1,
        "visible": true,
        "fontSize": 10,
        "badge": false,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": true,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "engine",
        "slot": "bottom-left",
        "region": "image",
        "row": 0,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": true,
        "bold": true,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "",
        "iconScale": 1,
        "visible": true,
        "fontSize": 10,
        "badge": true,
        "hideWhenEmpty": false,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "title",
        "slot": "bottom-center",
        "region": "bottom",
        "row": 0,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": false,
        "bold": true,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "",
        "iconScale": 1,
        "visible": true,
        "fontSize": 19,
        "badge": false,
        "hideWhenEmpty": false,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "status",
        "slot": "bottom-right",
        "region": "image",
        "row": 0,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": true,
        "bold": true,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "",
        "iconScale": 1,
        "visible": true,
        "fontSize": 11,
        "badge": true,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "version",
        "slot": "bottom-right",
        "region": "image",
        "row": 0,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": true,
        "bold": true,
        "italic": false,
        "border": {
          "width": 1,
          "color": "#5c5c5c"
        },
        "textColor": "",
        "iconScale": 1,
        "visible": true,
        "fontSize": 11,
        "badge": true,
        "hideWhenEmpty": false,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "favorite",
        "slot": "top-left-floating",
        "region": "image",
        "row": 0,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "",
        "iconScale": 1,
        "visible": true,
        "fontSize": 10,
        "badge": false,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": true,
          "source": []
        }
      },
      {
        "id": "wishlist",
        "slot": "top-right-floating",
        "region": "image",
        "row": 0,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "",
        "iconScale": 1,
        "visible": true,
        "fontSize": 10,
        "badge": false,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": true,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "likes",
        "slot": "bottom-left",
        "region": "bottom",
        "row": 3,
        "align": "left",
        "order": 1,
        "offsetX": 2,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "#c7c7c7",
        "iconScale": 1.2,
        "visible": true,
        "fontSize": 15,
        "badge": false,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "views",
        "slot": "bottom-left",
        "region": "bottom",
        "row": 3,
        "align": "left",
        "order": 2,
        "offsetX": 4,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "#c7c7c7",
        "iconScale": 1.2,
        "visible": true,
        "fontSize": 14,
        "badge": false,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "sourceRating",
        "slot": "bottom-right",
        "region": "bottom",
        "row": 3,
        "align": "left",
        "order": 3,
        "offsetX": 6,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "#c7c7c7",
        "iconScale": 1.2,
        "visible": true,
        "fontSize": 14,
        "badge": false,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "tags",
        "slot": "center",
        "region": "bottom",
        "row": 5,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 1,
          "color": "#555353"
        },
        "textColor": "",
        "iconScale": 1,
        "visible": true,
        "fontSize": 13,
        "badge": true,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "platforms",
        "slot": "bottom-left",
        "region": "bottom",
        "row": 4,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "",
        "iconScale": 1,
        "visible": true,
        "fontSize": 12,
        "badge": false,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      },
      {
        "id": "lastUpdated",
        "slot": "bottom-left",
        "region": "bottom",
        "row": 3,
        "align": "left",
        "order": 0,
        "offsetX": 0,
        "offsetY": 0,
        "textShadow": false,
        "bold": false,
        "italic": false,
        "border": {
          "width": 0,
          "color": "#000000"
        },
        "textColor": "#c7c7c7",
        "iconScale": 1.2,
        "visible": true,
        "fontSize": 14,
        "badge": false,
        "hideWhenEmpty": true,
        "conditions": {
          "localOnly": false,
          "browseOnly": false,
          "wishlistOnly": false,
          "installedOnly": false,
          "uninstalledOnly": false,
          "updateOnly": false,
          "favoriteOnly": false,
          "source": []
        }
      }
    ]
  },
]

export const getBuiltInBannerLayoutOptions = () =>
  defaultBannerLayouts.map(({ id, name }) => ({ id, name }))
