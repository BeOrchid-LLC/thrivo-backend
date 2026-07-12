import { emailBrand, emailFonts, emailTokens } from "../tokens";

/** Escape text destined for HTML so template props can't inject markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Branded, inline-styled HTML shell shared by every template (inline styles
 * because email clients ignore <style>/external CSS). `contentHtml` is trusted
 * markup the template already escaped; callers must escape any user-provided
 * text before passing it in.
 *
 * @deprecated Superseded by `emailShell` + `emailHeader`/`emailFooter` below,
 * which add dark-mode support and match the redesigned templates. Kept as-is
 * so `notification.ts` keeps rendering unchanged until it's migrated over.
 */
export function baseLayout(opts: { contentHtml: string }): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:24px 32px;background:#16a34a;color:#ffffff;font-size:20px;font-weight:700;">Thrivo</td></tr>
          <tr><td style="padding:32px;color:#18181b;font-size:15px;line-height:1.6;">${opts.contentHtml}</td></tr>
          <tr><td style="padding:20px 32px;background:#fafafa;color:#71717a;font-size:12px;line-height:1.5;">
            You're receiving this because you have a Thrivo account.<br/>Thrivo · BeOrchid LLC
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * "T" brandmark, ported from the production asset (`thrivo-public/public/icons/logo.svg`)
 * rather than re-derived from Figma's rotated/flipped div transforms, so the
 * mark stays pixel-true to the one already shipping on the web/admin apps.
 */
const LOGOMARK_SVG = `<svg width="22" height="22" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Thrivo">
  <path d="M30.1369 0C41.0313 0 49.863 8.83164 49.863 19.726V70.137C49.863 75.5842 45.4471 80 39.9999 80C34.5528 80 30.1369 75.5842 30.1369 70.137V0Z" fill="#09823C"/>
  <path d="M19.726 19.726C8.83163 19.726 0 10.8944 0 0L30.137 0C41.0314 0 49.863 8.83163 49.863 19.726L19.726 19.726Z" fill="#09823C"/>
  <path d="M49.8629 0C38.9686 0 30.1369 8.83165 30.1369 19.726L60.2739 19.726C71.1683 19.726 79.9999 10.8944 79.9999 0L49.8629 0Z" fill="#F39C12"/>
</svg>`;

/** Icon glyphs, ported from Figma where noted (OTP frame 277:472, magic-link frame 269:4). Paint via `currentColor`. */
const ICONS: Record<
  "seal-check" | "envelope" | "link" | "clock" | "check" | "shield",
  { viewBox: string; content: string }
> = {
  // Figma asset 4a025153a3dfa4dccc37e8f8fea6077ca37d0ca8.svg — the OTP icon-badge glyph.
  "seal-check": {
    viewBox: "0 0 32 32",
    content: `<path d="M28.0525 13.025C27.565 12.5162 27.0612 11.9912 26.8587 11.5025C26.6712 11.0487 26.6612 10.3775 26.65 9.6675C26.6325 8.495 26.6125 7.1675 25.7225 6.2775C24.8325 5.3875 23.5 5.3675 22.3325 5.35C21.6225 5.33875 20.9575 5.32875 20.4975 5.14125C20.0087 4.93875 19.4838 4.435 18.975 3.9475C18.145 3.1525 17.205 2.25 16 2.25C14.795 2.25 13.855 3.1525 13.025 3.9475C12.5162 4.435 11.9912 4.93875 11.5025 5.14125C11.0487 5.32875 10.3775 5.33875 9.6675 5.35C8.495 5.3675 7.1675 5.3875 6.2775 6.2775C5.3875 7.1675 5.3675 8.5 5.35 9.6675C5.33875 10.3775 5.32875 11.0425 5.14125 11.5025C4.93875 11.9912 4.435 12.5162 3.9475 13.025C3.1525 13.855 2.25 14.795 2.25 16C2.25 17.205 3.1525 18.145 3.9475 18.975C4.435 19.4838 4.93875 20.0087 5.14125 20.4975C5.32875 20.9512 5.33875 21.6225 5.35 22.3325C5.3675 23.505 5.3875 24.8325 6.2775 25.7225C7.1675 26.6125 8.5 26.6325 9.6675 26.65C10.3775 26.6612 11.0425 26.6712 11.5025 26.8587C11.9912 27.0612 12.5162 27.565 13.025 28.0525C13.855 28.8475 14.795 29.75 16 29.75C17.205 29.75 18.145 28.8475 18.975 28.0525C19.4838 27.565 20.0087 27.0612 20.4975 26.8587C20.9512 26.6712 21.6225 26.6612 22.3325 26.65C23.505 26.6325 24.8325 26.6125 25.7225 25.7225C26.6125 24.8325 26.6325 23.505 26.65 22.3325C26.6612 21.6225 26.6712 20.9575 26.8587 20.4975C27.0612 20.0087 27.565 19.4838 28.0525 18.975C28.8475 18.145 29.75 17.205 29.75 16C29.75 14.795 28.8475 13.855 28.0525 13.025ZM26.97 17.9375C26.3862 18.545 25.7825 19.175 25.47 19.925C25.1725 20.6425 25.16 21.49 25.1475 22.31C25.1337 23.24 25.1187 24.2025 24.66 24.6625C24.2012 25.1225 23.2375 25.1362 22.3075 25.15C21.4875 25.1625 20.64 25.175 19.9225 25.4725C19.1725 25.7825 18.5475 26.3862 17.9338 26.9725C17.2775 27.5975 16.5988 28.2525 15.9975 28.2525C15.3963 28.2525 14.7175 27.6012 14.06 26.9725C13.4525 26.3887 12.8225 25.785 12.0725 25.4725C11.355 25.175 10.5075 25.1625 9.6875 25.15C8.7575 25.1362 7.795 25.1213 7.335 24.6625C6.875 24.2038 6.86125 23.24 6.8475 22.31C6.835 21.49 6.8225 20.6425 6.525 19.925C6.215 19.175 5.61125 18.55 5.025 17.9363C4.40125 17.28 3.75 16.6012 3.75 16C3.75 15.3988 4.40125 14.72 5.03 14.0625C5.61375 13.455 6.2175 12.825 6.53 12.075C6.8275 11.3575 6.84 10.51 6.8525 9.69C6.86625 8.76 6.88125 7.7975 7.34 7.3375C7.79875 6.8775 8.7625 6.86375 9.6925 6.85C10.5125 6.8375 11.36 6.825 12.0775 6.5275C12.8275 6.2175 13.4525 5.61375 14.0662 5.0275C14.72 4.40125 15.3988 3.75 16 3.75C16.6012 3.75 17.28 4.40125 17.9375 5.03C18.545 5.61375 19.175 6.2175 19.925 6.53C20.6425 6.8275 21.49 6.84 22.31 6.8525C23.24 6.86625 24.2025 6.88125 24.6625 7.34C25.1225 7.79875 25.1362 8.7625 25.15 9.6925C25.1625 10.5125 25.175 11.36 25.4725 12.0775C25.7825 12.8275 26.3862 13.4525 26.9725 14.0662C27.5975 14.7225 28.2525 15.4013 28.2525 16.0025C28.2525 16.6038 27.5987 17.28 26.97 17.9375ZM21.53 12.47C21.6705 12.6106 21.7493 12.8012 21.7493 13C21.7493 13.1988 21.6705 13.3894 21.53 13.53L14.53 20.53C14.3894 20.6705 14.1988 20.7493 14 20.7493C13.8012 20.7493 13.6106 20.6705 13.47 20.53L10.47 17.53C10.3375 17.3878 10.2654 17.1998 10.2688 17.0055C10.2723 16.8112 10.351 16.6258 10.4884 16.4884C10.6258 16.351 10.8112 16.2723 11.0055 16.2688C11.1998 16.2654 11.3878 16.3375 11.53 16.47L14 18.9387L20.47 12.47C20.6106 12.3295 20.8012 12.2507 21 12.2507C21.1988 12.2507 21.3894 12.3295 21.53 12.47Z" fill="currentColor"/>`,
  },
  // Figma asset f9d5118f66d9e19eba44e36b8db52ff85442d5c6.svg — the magic-link icon-badge glyph.
  envelope: {
    viewBox: "0 0 32 32",
    content: `<path d="M28.4162 11.375L16.4163 3.375C16.293 3.29277 16.1482 3.24889 16 3.24889C15.8518 3.24889 15.707 3.29277 15.5838 3.375L3.58375 11.375C3.48092 11.4436 3.39665 11.5366 3.33842 11.6456C3.28019 11.7546 3.24982 11.8764 3.25 12V25C3.25 25.4641 3.43437 25.9092 3.76256 26.2374C4.09075 26.5656 4.53587 26.75 5 26.75H27C27.4641 26.75 27.9092 26.5656 28.2374 26.2374C28.5656 25.9092 28.75 25.4641 28.75 25V12C28.7502 11.8764 28.7198 11.7546 28.6616 11.6456C28.6034 11.5366 28.5191 11.4436 28.4162 11.375ZM12.5225 19L4.75 24.4875V13.4562L12.5225 19ZM14.0562 19.75H17.9438L25.73 25.25H6.27L14.0562 19.75ZM19.4775 19L27.25 13.4562V24.4875L19.4775 19ZM16 4.90125L26.6787 12.0262L17.9413 18.25H14.0588L5.32125 12.0212L16 4.90125Z" fill="currentColor"/>`,
  },
  // Figma asset f0a9258c65d2732d4f411e02c12482c2ad2804ea.svg — the "Sign in to Thrivo" button glyph.
  link: {
    viewBox: "0 0 17 17",
    content: `<path d="M10.9072 6.09277C10.9443 6.12978 10.9737 6.17372 10.9937 6.22209C11.0138 6.27046 11.0241 6.32231 11.0241 6.37467C11.0241 6.42703 11.0138 6.47888 10.9937 6.52725C10.9737 6.57562 10.9443 6.61956 10.9072 6.65656L6.65723 10.9066C6.58234 10.9803 6.48135 11.0215 6.37624 11.0211C6.27112 11.0208 6.17042 10.9789 6.09605 10.9046C6.02168 10.8303 5.97967 10.7297 5.97919 10.6246C5.9787 10.5195 6.01976 10.4184 6.09344 10.3434L10.3434 6.09344C10.3804 6.05635 10.4243 6.02691 10.4727 6.0068C10.521 5.98669 10.5728 5.97631 10.6252 5.97625C10.6776 5.97619 10.7294 5.98645 10.7778 6.00644C10.8262 6.02644 10.8702 6.05577 10.9072 6.09277ZM14.2242 2.77578C13.5511 2.10417 12.639 1.72699 11.6882 1.72699C10.7373 1.72699 9.82524 2.10417 9.15211 2.77578L7.15527 4.77129C7.08051 4.84605 7.03851 4.94745 7.03851 5.05318C7.03851 5.15891 7.08051 5.26031 7.15527 5.33508C7.23004 5.40984 7.33144 5.45184 7.43717 5.45184C7.5429 5.45184 7.6443 5.40984 7.71906 5.33508L9.7159 3.33891C10.2391 2.81574 10.9486 2.52183 11.6885 2.52183C12.4284 2.52183 13.1379 2.81574 13.6611 3.33891C14.1843 3.86207 14.4782 4.57164 14.4782 5.3115C14.4782 6.05137 14.1843 6.76094 13.6611 7.2841L11.6636 9.28094C11.6266 9.31796 11.5972 9.3619 11.5772 9.41027C11.5571 9.45864 11.5468 9.51048 11.5468 9.56283C11.5468 9.61519 11.5571 9.66703 11.5772 9.71539C11.5972 9.76376 11.6266 9.80771 11.6636 9.84473C11.7006 9.88175 11.7446 9.91111 11.7929 9.93115C11.8413 9.95118 11.8931 9.96149 11.9455 9.96149C11.9978 9.96149 12.0497 9.95118 12.098 9.93115C12.1464 9.91111 12.1904 9.88175 12.2274 9.84473L14.2242 7.84789C14.5573 7.51489 14.8216 7.11953 15.0019 6.68439C15.1821 6.24924 15.2749 5.78285 15.2749 5.31184C15.2749 4.84083 15.1821 4.37443 15.0019 3.93929C14.8216 3.50414 14.5573 3.10878 14.2242 2.77578ZM9.28094 11.6636L7.2841 13.6611C6.76094 14.1843 6.05137 14.4782 5.3115 14.4782C4.57164 14.4782 3.86207 14.1843 3.33891 13.6611C2.81574 13.1379 2.52183 12.4284 2.52183 11.6885C2.52183 10.9486 2.81574 10.2391 3.33891 9.7159L5.33508 7.71906C5.40984 7.6443 5.45184 7.5429 5.45184 7.43717C5.45184 7.33144 5.40984 7.23004 5.33508 7.15527C5.26031 7.08051 5.15891 7.03851 5.05318 7.03851C4.94745 7.03851 4.84605 7.08051 4.77129 7.15527L2.7791 9.15211C2.10641 9.82471 1.72846 10.737 1.7284 11.6883C1.72834 12.6395 2.10617 13.5519 2.77877 14.2246C3.45137 14.8972 4.36365 15.2752 5.31492 15.2753C6.26619 15.2753 7.17852 14.8975 7.85121 14.2249L9.84805 12.2274C9.88507 12.1904 9.91443 12.1464 9.93447 12.098C9.9545 12.0497 9.96481 11.9978 9.96481 11.9455C9.96481 11.8931 9.9545 11.8413 9.93447 11.7929C9.91443 11.7446 9.88507 11.7006 9.84805 11.6636C9.81103 11.6266 9.76708 11.5972 9.71871 11.5772C9.67034 11.5571 9.6185 11.5468 9.56615 11.5468C9.5138 11.5468 9.46196 11.5571 9.41359 11.5772C9.36523 11.5972 9.32128 11.6266 9.28426 11.6636H9.28094Z" fill="currentColor"/>`,
  },
  // Figma asset a9025bc0e2900cb333de02031d5603ef91fc5885.svg
  clock: {
    viewBox: "0 0 20 20",
    content: `<path d="M9.04688 2.3291C7.59442 2.3291 6.17458 2.75981 4.96691 3.56675C3.75924 4.37369 2.81797 5.52063 2.26214 6.86252C1.70631 8.20441 1.56088 9.681 1.84424 11.1055C2.1276 12.5301 2.82702 13.8386 3.85406 14.8657C4.8811 15.8927 6.18964 16.5921 7.61418 16.8755C9.03873 17.1589 10.5153 17.0134 11.8572 16.4576C13.1991 15.9018 14.346 14.9605 15.153 13.7528C15.9599 12.5451 16.3906 11.1253 16.3906 9.67285C16.3884 7.72587 15.6139 5.85928 14.2372 4.48255C12.8605 3.10582 10.9939 2.33138 9.04688 2.3291ZM9.04688 16.0791C7.77984 16.0791 6.54126 15.7034 5.48776 14.9995C4.43425 14.2955 3.61315 13.295 3.12828 12.1244C2.6434 10.9538 2.51654 9.66575 2.76372 8.42305C3.01091 7.18036 3.62105 6.03888 4.51698 5.14295C5.41291 4.24702 6.55439 3.63688 7.79708 3.3897C9.03977 3.14251 10.3279 3.26937 11.4984 3.75425C12.669 4.23912 13.6696 5.06023 14.3735 6.11373C15.0774 7.16723 15.4531 8.40582 15.4531 9.67285C15.4511 11.3713 14.7755 12.9995 13.5745 14.2005C12.3735 15.4014 10.7453 16.077 9.04688 16.0791ZM12.5031 6.2166C12.5909 6.30449 12.6402 6.42363 12.6402 6.54785C12.6402 6.67207 12.5909 6.79121 12.5031 6.8791L9.37813 10.0041C9.33522 10.0502 9.28347 10.0871 9.22597 10.1127C9.16847 10.1383 9.10639 10.1521 9.04345 10.1532C8.98052 10.1543 8.918 10.1428 8.85963 10.1192C8.80126 10.0956 8.74824 10.0605 8.70373 10.016C8.65922 9.97149 8.62413 9.91847 8.60055 9.8601C8.57698 9.80173 8.5654 9.73921 8.56651 9.67628C8.56762 9.61334 8.5814 9.55126 8.60702 9.49376C8.63264 9.43627 8.66957 9.38451 8.71563 9.3416L11.8406 6.2166C11.9285 6.12882 12.0477 6.07951 12.1719 6.07951C12.2961 6.07951 12.4152 6.12882 12.5031 6.2166ZM6.70313 0.297852C6.70313 0.173531 6.75251 0.054303 6.84042 -0.0336047C6.92833 -0.121512 7.04756 -0.170898 7.17188 -0.170898H10.9219C11.0462 -0.170898 11.1654 -0.121512 11.2533 -0.0336047C11.3412 0.054303 11.3906 0.173531 11.3906 0.297852C11.3906 0.422172 11.3412 0.5414 11.2533 0.629308C11.1654 0.717216 11.0462 0.766602 10.9219 0.766602H7.17188C7.04756 0.766602 6.92833 0.717216 6.84042 0.629308C6.75251 0.5414 6.70313 0.422172 6.70313 0.297852Z" fill="currentColor"/>`,
  },
  // Figma asset 8310639ce2c0f4427b682d0c644ffc25aff906fe.svg
  check: {
    viewBox: "0 0 20 20",
    content: `<path d="M12.5031 6.8416C12.5909 6.92949 12.6402 7.04863 12.6402 7.17285C12.6402 7.29707 12.5909 7.41621 12.5031 7.5041L8.12813 11.8791C8.04024 11.9669 7.9211 12.0162 7.79688 12.0162C7.67266 12.0162 7.55352 11.9669 7.46563 11.8791L5.59063 10.0041C5.50783 9.91524 5.46275 9.79771 5.46489 9.67628C5.46704 9.55484 5.51623 9.43897 5.60212 9.35309C5.688 9.26721 5.80386 9.21801 5.9253 9.21587C6.04674 9.21372 6.16427 9.2588 6.25313 9.3416L7.79688 10.8846L11.8406 6.8416C11.9285 6.75382 12.0477 6.70451 12.1719 6.70451C12.2961 6.70451 12.4152 6.75382 12.5031 6.8416ZM17.0156 9.04785C17.0156 10.6239 16.5483 12.1646 15.6727 13.4751C14.797 14.7855 13.5525 15.8069 12.0964 16.41C10.6403 17.0132 9.03804 17.171 7.49225 16.8635C5.94647 16.556 4.52657 15.7971 3.41212 14.6826C2.29767 13.5682 1.53872 12.1483 1.23125 10.6025C0.92377 9.05669 1.08158 7.45444 1.68471 5.99834C2.28785 4.54224 3.30922 3.2977 4.61968 2.42208C5.93013 1.54646 7.47081 1.0791 9.04688 1.0791C11.1596 1.08158 13.185 1.92194 14.6789 3.41583C16.1728 4.90973 17.0131 6.93517 17.0156 9.04785ZM16.0781 9.04785C16.0781 7.6572 15.6658 6.29778 14.8931 5.1415C14.1205 3.98522 13.0224 3.084 11.7376 2.55182C10.4528 2.01964 9.03908 1.8804 7.67515 2.15171C6.31122 2.42301 5.05837 3.09267 4.07503 4.07601C3.0917 5.05934 2.42203 6.31219 2.15073 7.67612C1.87943 9.04005 2.01867 10.4538 2.55085 11.7386C3.08303 13.0234 3.98424 14.1215 5.14053 14.8941C6.29681 15.6667 7.65623 16.0791 9.04688 16.0791C10.911 16.077 12.6983 15.3356 14.0164 14.0174C15.3346 12.6992 16.0761 10.912 16.0781 9.04785Z" fill="currentColor"/>`,
  },
  // Figma asset 5cb97c5ea802ece8620cfeee9459600a128c7b68.svg
  shield: {
    viewBox: "0 0 20 20",
    content: `<path d="M15.2969 2.3291H2.79688C2.50679 2.3291 2.22859 2.44434 2.02348 2.64945C1.81836 2.85457 1.70312 3.13277 1.70312 3.42285V7.79785C1.70312 11.8557 3.66562 14.3135 5.3125 15.6604C7.08828 17.1135 8.84922 17.6049 8.92344 17.6252C9.00425 17.6473 9.0895 17.6473 9.17031 17.6252C9.24453 17.6049 11.0055 17.1135 12.7813 15.6604C14.4281 14.3135 16.3906 11.8557 16.3906 7.79785V3.42285C16.3906 3.13277 16.2754 2.85457 16.0703 2.64945C15.8652 2.44434 15.587 2.3291 15.2969 2.3291ZM15.4531 7.79785C15.4531 10.7479 14.3641 13.1408 12.2156 14.9119C11.2731 15.6859 10.2001 16.2854 9.04688 16.6822C7.89354 16.2857 6.8204 15.6862 5.87813 14.9119C3.72969 13.1408 2.64062 10.7479 2.64062 7.79785V3.42285C2.64062 3.38141 2.65709 3.34167 2.68639 3.31237C2.71569 3.28306 2.75543 3.2666 2.79688 3.2666H15.2969C15.3383 3.2666 15.3781 3.28306 15.4074 3.31237C15.4367 3.34167 15.4531 3.38141 15.4531 3.42285V7.79785ZM12.5031 6.8416C12.5909 6.92949 12.6402 7.04863 12.6402 7.17285C12.6402 7.29707 12.5909 7.41621 12.5031 7.5041L8.12812 11.8791C8.04023 11.9669 7.92109 12.0162 7.79688 12.0162C7.67266 12.0162 7.55352 11.9669 7.46563 11.8791L5.59063 10.0041C5.50783 9.91524 5.46275 9.79771 5.46489 9.67628C5.46703 9.55484 5.51623 9.43897 5.60211 9.35309C5.68799 9.26721 5.80386 9.21801 5.9253 9.21587C6.04674 9.21373 6.16427 9.2588 6.25312 9.3416L7.79688 10.8846L11.8406 6.8416C11.9285 6.75382 12.0477 6.70451 12.1719 6.70451C12.2961 6.70451 12.4152 6.75382 12.5031 6.8416Z" fill="currentColor"/>`,
  },
};

/**
 * Outer HTML shell for the redesigned templates. Adds `color-scheme` meta
 * tags and a real `<style>` block with a `prefers-color-scheme: dark`
 * override (`!important`, per the designer's note) on top of light-mode
 * inline-style fallbacks for clients that strip `<style>`.
 *
 * Matches the Figma structure (frame 277:472): `headerHtml` and `footerHtml`
 * sit directly on the page background; only `cardHtml` gets the bordered,
 * rounded card treatment. All three are trusted markup the caller already
 * escaped; callers must escape any user-provided text before passing it in.
 */
export function emailShell(opts: {
  headerHtml: string;
  cardHtml: string;
  footerHtml: string;
}): string {
  const light = emailTokens.light;
  const dark = emailTokens.dark;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <meta name="color-scheme" content="light dark"/>
    <meta name="supported-color-schemes" content="light dark"/>
    <style>
      .email-bg { background: ${light.pageBg}; }
      .email-card { background: ${light.cardBg}; border-color: ${light.cardBorder}; }
      .email-heading { color: ${light.headingText}; }
      .email-body { color: ${light.bodyText}; }
      .email-muted { color: ${light.mutedText}; }
      .email-accent { color: ${light.accent}; }
      .email-icon-tint { background: ${light.iconTint}; }
      .email-border { border-color: ${light.border}; background: ${light.border}; }
      .email-input { background: ${light.inputBg}; border-color: ${light.border}; }
      @media (prefers-color-scheme: dark) {
        .email-bg { background: ${dark.pageBg} !important; }
        .email-card { background: ${dark.cardBg} !important; border-color: ${dark.cardBorder} !important; }
        .email-heading { color: ${dark.headingText} !important; }
        .email-body { color: ${dark.bodyText} !important; }
        .email-muted { color: ${dark.mutedText} !important; }
        .email-accent { color: ${dark.accent} !important; }
        .email-icon-tint { background: ${dark.iconTint} !important; }
        .email-border { border-color: ${dark.border} !important; background: ${dark.border} !important; }
        .email-input { background: ${dark.inputBg} !important; border-color: ${dark.border} !important; }
      }
    </style>
  </head>
  <body class="email-bg" style="margin:0;padding:0;background:${light.pageBg};font-family:${emailFonts.body};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-bg" style="background:${light.pageBg};">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:390px;">
          <tr><td style="padding:28px 24px 20px;">${opts.headerHtml}</td></tr>
          <tr><td style="padding:0 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-card" style="background:${light.cardBg};border:1px solid ${light.cardBorder};border-radius:16px;">
              <tr><td>${opts.cardHtml}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:20px 24px 4px;">${opts.footerHtml}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * Logomark + wordmark. Centered when there's no `eyebrow` (OTP, magic link);
 * left-aligned with the eyebrow badge on the right when one is passed (nudge,
 * recap).
 */
export function emailHeader(opts?: { eyebrow?: string }): string {
  const brand = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">${LOGOMARK_SVG}</td>
      <td class="email-heading" style="vertical-align:middle;padding-left:8px;font-size:16px;font-weight:700;letter-spacing:0.2px;">THRIVO</td>
    </tr></table>`;

  if (!opts?.eyebrow) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">${brand}</td></tr></table>`;
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="left">${brand}</td>
      <td class="email-accent" align="right" style="font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${escapeHtml(
        opts.eyebrow
      )}</td>
    </tr></table>`;
}

/** Centered circular icon badge used above the heading in OTP/magic-link — 60px circle, 32px glyph (Figma 277:485). */
export function emailIconBadge(variant: "seal-check" | "envelope"): string {
  const icon = ICONS[variant];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="email-icon-tint" style="width:60px;height:60px;border-radius:30px;background:${emailTokens.light.iconTint};text-align:center;vertical-align:middle;">
        <table role="presentation" width="100%" height="60" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" class="email-accent" style="color:${emailTokens.light.accent};">
          <svg width="32" height="32" viewBox="${icon.viewBox}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;">${icon.content}</svg>
        </td></tr></table>
      </td></tr></table>
    </td></tr></table>`;
}

/** One icon + text row, for the small bullet lists under OTP/magic-link CTAs (Figma "InfoRow", 277:510 etc). */
export function emailIconRow(opts: { icon: "clock" | "check" | "shield"; text: string }): string {
  const icon = ICONS[opts.icon];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="email-body" width="20" valign="top" style="padding:16px 10px 16px 0;">
        <svg width="20" height="20" viewBox="${icon.viewBox}" xmlns="http://www.w3.org/2000/svg">${icon.content}</svg>
      </td>
      <td class="email-body" style="font-size:14px;line-height:1.4;padding:16px 0;">${escapeHtml(opts.text)}</td>
    </tr></table>`;
}

/**
 * Full-width green CTA button (Figma "Button", 269:25) — 50px tall, rounded 12px,
 * optional leading icon. Uses the fixed brand green, not the light/dark `accent`
 * token — confirmed by the dark magic-link frame (277:414) that this button
 * doesn't switch shade the way the icon badge and links do.
 */
export function emailButton(opts: { label: string; url: string; icon?: "link" }): string {
  const iconHtml = opts.icon
    ? `<svg width="17" height="17" viewBox="${ICONS[opts.icon].viewBox}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:12px;">${ICONS[opts.icon].content}</svg>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${emailBrand.green};border-radius:12px;text-align:center;">
      <a href="${escapeHtml(
        opts.url
      )}" style="display:block;padding:15px 24px;color:${emailTokens.light.accentText};font-size:16px;font-weight:600;text-decoration:none;line-height:20px;">${iconHtml}${escapeHtml(
        opts.label
      )}</a>
    </td></tr></table>`;
}

/** Full-bleed 1px rule (Figma "Div"/"Container" separators). Inset it by placing inside a padded cell. */
export function emailDivider(): string {
  return `<div class="email-border" style="height:1px;line-height:1px;font-size:1px;background:${emailTokens.light.border};">&nbsp;</div>`;
}

/**
 * Secondary card below the main card for CTA-button templates: "having trouble"
 * fallback link (Figma "Card:margin" 269:53). The link color in Figma
 * (#27ae60) is a one-off, slightly brighter green than the shared accent
 * token (#09823c) — close enough that we reuse `email-accent` rather than
 * add a bespoke color for a single secondary-link use.
 */
export function emailFallbackLinkCard(opts: { url: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-card" style="background:${emailTokens.light.cardBg};border:1px solid ${emailTokens.light.cardBorder};border-radius:16px;margin-top:12px;">
      <tr><td style="padding:16px 20px;">
        <p class="email-body" style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;">Having trouble? Copy and paste this link into your browser: <span class="email-accent" style="font-weight:600;">${escapeHtml(
          opts.url
        )}</span></p>
      </td></tr>
    </table>`;
}

/** "Sent to {email}" + copyright + unsubscribe, shared by every redesigned template. */
export function emailFooter(opts: { recipientEmail: string; unsubscribeUrl: string }): string {
  const year = new Date().getFullYear();
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" class="email-muted" style="font-size:12px;line-height:1.5;">
      Sent to ${escapeHtml(opts.recipientEmail)}<br/>
      © ${year} Thrivo · BeOrchid LLC · <a href="${escapeHtml(
        opts.unsubscribeUrl
      )}" class="email-muted" style="text-decoration:underline;">Unsubscribe</a>
    </td></tr></table>`;
}
