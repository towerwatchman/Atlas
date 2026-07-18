import gogLogo from '../../assets/icons/gog_logo.svg'

// GOG's mark shipped as an SVG asset. Rendering it via <img src> would ignore
// the surrounding text color (an <img>-loaded SVG can't inherit CSS `color`),
// so it's drawn as a CSS mask instead: the SVG becomes a stencil and the fill
// comes from `currentColor`. That makes it behave exactly like the Font Awesome
// Steam glyph next to it — it takes on the text/muted color of its context and
// adapts across every theme.
//
// `size` sets both width and height (px). Any extra props (className, style,
// title, aria-*) are spread onto the span so callers can position it.
export default function GogIcon({ size = 16, className = '', style = {}, ...rest }) {
  return (
    <span
      role="img"
      aria-label="GOG"
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundColor: 'currentColor',
        WebkitMaskImage: `url(${gogLogo})`,
        maskImage: `url(${gogLogo})`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        ...style,
      }}
      {...rest}
    />
  )
}
