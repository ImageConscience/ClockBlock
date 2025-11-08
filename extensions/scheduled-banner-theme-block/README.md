# Scheduled Banner Theme Block

This theme app extension renders a single scheduled banner selected from ClockBlock metaobjects. Merchants can control layout and styling via theme settings.

## Configuration tips

- **Overlay colour & opacity** – the `Overlay colour` and `Overlay opacity` settings drive a CSS gradient rendered by the block. No additional filters are required; the block publishes CSS variables that power the overlay.
- **Mobile layout** – toggling *Show content below banner on mobile* moves the button/text out of the overlay and into a separate section for readability.
- **Breakpoint** – the `Breakpoint` setting controls when the mobile layout activates (default `768px`).
- **Typography** – headline, description, and button fonts inherit the selected typography settings; ensure custom fonts are available via the theme.

## Developer notes

- The block reads metaobjects with type `schedulable_entity`. Ensure the app has created the definition and assigned entries before adding the block to a theme.
- All overlay logic now lives in CSS (`scheduled-banner__banner-content::before`), so there are no Liquid filters that depend on Shopify-specific helpers.
- Run `shopify extension serve --directory=extensions/scheduled-banner-theme-block` during development and `shopify extension deploy ...` when ready for production.
