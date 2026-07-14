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
 * "T" brandmark, ported from the production asset (`thrivo-public/public/icons/logo.svg`)
 * rather than re-derived from Figma's rotated/flipped div transforms, so the
 * mark stays pixel-true to the one already shipping on the web/admin apps.
 */
const LOGOMARK_SVG = `<svg width="22" height="22" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Thrivo">
  <path d="M30.1369 0C41.0313 0 49.863 8.83164 49.863 19.726V70.137C49.863 75.5842 45.4471 80 39.9999 80C34.5528 80 30.1369 75.5842 30.1369 70.137V0Z" fill="#09823C"/>
  <path d="M19.726 19.726C8.83163 19.726 0 10.8944 0 0L30.137 0C41.0314 0 49.863 8.83163 49.863 19.726L19.726 19.726Z" fill="#09823C"/>
  <path d="M49.8629 0C38.9686 0 30.1369 8.83165 30.1369 19.726L60.2739 19.726C71.1683 19.726 79.9999 10.8944 79.9999 0L49.8629 0Z" fill="#F39C12"/>
</svg>`;

/**
 * Icon glyphs, ported from Figma where noted (OTP frame 277:472, magic-link
 * frame 269:4, weekly-review frame 269:134). Paint via `currentColor`.
 */
const ICONS: Record<
  | "seal-check"
  | "envelope"
  | "link"
  | "clock"
  | "check"
  | "check-circle"
  | "shield"
  | "fork"
  | "arrow-right"
  | "warning"
  | "trending",
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
  // Figma asset 0bf251dc382f09776872dc0e73f68fc919e148d8.svg — weekly-review frame (269:134), replaces
  // the earlier hand-drawn placeholder now that the real button glyph is available.
  fork: {
    viewBox: "0 0 16 16",
    content: `<path d="M4.625 5.5V2.5C4.625 2.40054 4.66451 2.30516 4.73484 2.23484C4.80516 2.16451 4.90054 2.125 5 2.125C5.09946 2.125 5.19484 2.16451 5.26516 2.23484C5.33549 2.30516 5.375 2.40054 5.375 2.5V5.5C5.375 5.59946 5.33549 5.69484 5.26516 5.76516C5.19484 5.83549 5.09946 5.875 5 5.875C4.90054 5.875 4.80516 5.83549 4.73484 5.76516C4.66451 5.69484 4.625 5.59946 4.625 5.5ZM13.375 2.5V14C13.375 14.0995 13.3355 14.1948 13.2652 14.2652C13.1948 14.3355 13.0995 14.375 13 14.375C12.9005 14.375 12.8052 14.3355 12.7348 14.2652C12.6645 14.1948 12.625 14.0995 12.625 14V10.875H9.5C9.40054 10.875 9.30516 10.8355 9.23483 10.7652C9.16451 10.6948 9.125 10.5995 9.125 10.5C9.125 10.2244 9.1675 3.73438 12.8525 2.15563C12.9095 2.13124 12.9717 2.12136 13.0334 2.12689C13.0952 2.13242 13.1546 2.15317 13.2064 2.18729C13.2581 2.22141 13.3006 2.26783 13.3301 2.32241C13.3595 2.37698 13.3749 2.438 13.375 2.5ZM12.625 3.125C10.3256 4.64313 9.94875 8.8425 9.88688 10.125H12.625V3.125ZM7.37 2.4375C7.36179 2.38891 7.34409 2.34241 7.31792 2.30066C7.29174 2.25892 7.2576 2.22273 7.21744 2.19418C7.17727 2.16562 7.13188 2.14526 7.08385 2.13425C7.03582 2.12324 6.98609 2.12179 6.9375 2.13C6.88891 2.13821 6.84241 2.15591 6.80066 2.18208C6.75891 2.20826 6.72273 2.2424 6.69418 2.28256C6.66562 2.32273 6.64526 2.36812 6.63425 2.41615C6.62324 2.46418 6.62179 2.51391 6.63 2.5625L7.125 5.53C7.125 6.09359 6.90112 6.63409 6.5026 7.0326C6.10409 7.43112 5.56359 7.655 5 7.655C4.43641 7.655 3.89591 7.43112 3.4974 7.0326C3.09888 6.63409 2.875 6.09359 2.875 5.53L3.37 2.5625C3.38658 2.46437 3.36349 2.36367 3.30582 2.28256C3.24816 2.20146 3.16063 2.14658 3.0625 2.13C2.96437 2.11342 2.86367 2.13651 2.78256 2.19418C2.70146 2.25184 2.64658 2.33937 2.63 2.4375L2.13 5.4375C2.12675 5.45818 2.12508 5.47907 2.125 5.5C2.1259 6.19725 2.37983 6.87047 2.83962 7.39463C3.29941 7.91879 3.93381 8.25827 4.625 8.35V14C4.625 14.0995 4.66451 14.1948 4.73484 14.2652C4.80516 14.3355 4.90054 14.375 5 14.375C5.09946 14.375 5.19484 14.3355 5.26516 14.2652C5.33549 14.1948 5.375 14.0995 5.375 14V8.35C6.06619 8.25827 6.70059 7.91879 7.16038 7.39463C7.62017 6.87047 7.8741 6.19725 7.875 5.5C7.87492 5.47907 7.87325 5.45818 7.87 5.4375L7.37 2.4375Z" fill="currentColor"/>`,
  },
  // Figma asset 5be69abf5d01e901f75c1b85300a4a4747b999c2.svg — weekly-review frame, button trailing icon.
  "arrow-right": {
    viewBox: "0 0 15 15",
    content: `<path d="M12.9047 7.74844L8.68594 11.9672C8.61929 12.0293 8.53115 12.0631 8.44007 12.0615C8.34899 12.0599 8.26209 12.023 8.19768 11.9586C8.13327 11.8942 8.09637 11.8073 8.09476 11.7162C8.09316 11.6251 8.12696 11.537 8.18906 11.4703L11.8072 7.85156H2.34375C2.25051 7.85156 2.16109 7.81452 2.09516 7.74859C2.02923 7.68266 1.99219 7.59324 1.99219 7.5C1.99219 7.40676 2.02923 7.31734 2.09516 7.25141C2.16109 7.18548 2.25051 7.14844 2.34375 7.14844H11.8072L8.18906 3.52969C8.12696 3.46304 8.09316 3.3749 8.09476 3.28382C8.09637 3.19274 8.13327 3.10584 8.19768 3.04143C8.26209 2.97701 8.34899 2.94012 8.44007 2.93851C8.53115 2.9369 8.61929 2.97071 8.68594 3.03281L12.9047 7.25156C12.9705 7.31748 13.0075 7.40684 13.0075 7.5C13.0075 7.59316 12.9705 7.68252 12.9047 7.74844Z" fill="currentColor"/>`,
  },
  // Figma asset 57024ffa452f1497f16a8ffcf4ad64b15938c2ae.svg — weekly-review info-row 1 (fill-opacity 0.5 in
  // Figma; opacity applied by the caller via the soft-muted color instead, since currentColor already
  // carries that alpha through the class/inline-style, and baking it into the path too would double it).
  "check-circle": {
    viewBox: "0 0 14 14",
    content: `<path d="M9.41938 5.45563C9.48082 5.51715 9.51534 5.60055 9.51534 5.6875C9.51534 5.77445 9.48082 5.85785 9.41938 5.91937L6.35687 8.98188C6.29535 9.04332 6.21195 9.07784 6.125 9.07784C6.03805 9.07784 5.95465 9.04332 5.89313 8.98188L4.58063 7.66938C4.52267 7.60717 4.49111 7.5249 4.49261 7.4399C4.49411 7.35489 4.52855 7.27378 4.58867 7.21367C4.64878 7.15355 4.72989 7.11911 4.8149 7.11761C4.8999 7.11611 4.98217 7.14766 5.04437 7.20562L6.125 8.2857L8.95562 5.45563C9.01715 5.39418 9.10055 5.35966 9.1875 5.35966C9.27445 5.35966 9.35785 5.39418 9.41938 5.45563ZM12.5781 7C12.5781 8.10325 12.251 9.18172 11.638 10.099C11.0251 11.0164 10.1539 11.7313 9.13466 12.1535C8.11539 12.5757 6.99381 12.6862 5.91176 12.4709C4.82971 12.2557 3.83578 11.7244 3.05567 10.9443C2.27556 10.1642 1.74429 9.17029 1.52906 8.08824C1.31382 7.00619 1.42429 5.88461 1.84648 4.86534C2.26868 3.84608 2.98364 2.97489 3.90096 2.36196C4.81828 1.74903 5.89675 1.42188 7 1.42188C8.47888 1.42361 9.89669 2.01186 10.9424 3.05759C11.9881 4.10331 12.5764 5.52112 12.5781 7ZM11.9219 7C11.9219 6.02655 11.6332 5.07495 11.0924 4.26555C10.5516 3.45615 9.78288 2.82531 8.88352 2.45278C7.98417 2.08026 6.99454 1.98279 6.03979 2.1727C5.08504 2.36261 4.20805 2.83137 3.51971 3.51971C2.83137 4.20805 2.36261 5.08504 2.1727 6.03979C1.98279 6.99454 2.08026 7.98417 2.45278 8.88352C2.82531 9.78288 3.45615 10.5516 4.26555 11.0924C5.07495 11.6332 6.02655 11.9219 7 11.9219C8.30492 11.9204 9.55598 11.4014 10.4787 10.4787C11.4014 9.55598 11.9204 8.30492 11.9219 7Z" fill="currentColor"/>`,
  },
  // Figma asset 8f74df0cae4cf014256c67a9a85c487c28f76853.svg — weekly-review info-row 2, replaces the
  // earlier hand-drawn placeholder now that the real glyph is available.
  warning: {
    viewBox: "0 0 14 14",
    content: `<path d="M12.8554 10.3409L8.07242 2.03547C7.96257 1.84868 7.80583 1.69382 7.61773 1.58623C7.42964 1.47864 7.2167 1.42204 7 1.42204C6.7833 1.42204 6.57036 1.47864 6.38227 1.58623C6.19417 1.69382 6.03743 1.84868 5.92758 2.03547L1.14461 10.3409C1.03933 10.5211 0.983847 10.726 0.983847 10.9348C0.983847 11.1435 1.03933 11.3485 1.14461 11.5287C1.253 11.7168 1.40952 11.8726 1.5981 11.9802C1.78668 12.0877 2.0005 12.1431 2.21758 12.1406H11.7824C11.9993 12.1429 12.2129 12.0874 12.4013 11.9799C12.5896 11.8723 12.746 11.7166 12.8543 11.5287C12.9597 11.3485 13.0154 11.1436 13.0156 10.9349C13.0158 10.7262 12.9605 10.5212 12.8554 10.3409ZM12.2861 11.2C12.235 11.2879 12.1614 11.3606 12.0728 11.4105C11.9843 11.4605 11.8841 11.486 11.7824 11.4844H2.21758C2.11593 11.486 2.01568 11.4605 1.92715 11.4105C1.83862 11.3606 1.76502 11.2879 1.71391 11.2C1.6661 11.1196 1.64086 11.0278 1.64086 10.9342C1.64086 10.8407 1.6661 10.7488 1.71391 10.6684L6.49633 2.36305C6.54861 2.27619 6.62247 2.20434 6.71072 2.15445C6.79897 2.10457 6.89862 2.07836 7 2.07836C7.10138 2.07836 7.20103 2.10457 7.28928 2.15445C7.37753 2.20434 7.45139 2.27619 7.50367 2.36305L12.2866 10.6684C12.3344 10.7489 12.3595 10.8407 12.3594 10.9343C12.3593 11.0278 12.334 11.1196 12.2861 11.2ZM6.67187 7.875V5.6875C6.67187 5.60048 6.70645 5.51702 6.76798 5.45548C6.82952 5.39395 6.91298 5.35937 7 5.35937C7.08702 5.35937 7.17048 5.39395 7.23202 5.45548C7.29355 5.51702 7.32812 5.60048 7.32812 5.6875V7.875C7.32812 7.96202 7.29355 8.04548 7.23202 8.10702C7.17048 8.16855 7.08702 8.20312 7 8.20312C6.91298 8.20312 6.82952 8.16855 6.76798 8.10702C6.70645 8.04548 6.67187 7.96202 6.67187 7.875ZM7.54687 9.84375C7.54687 9.95191 7.5148 10.0576 7.45471 10.1476C7.39462 10.2375 7.30921 10.3076 7.20928 10.349C7.10935 10.3904 6.99939 10.4012 6.89331 10.3801C6.78723 10.359 6.68978 10.3069 6.6133 10.2304C6.53682 10.154 6.48473 10.0565 6.46363 9.95044C6.44253 9.84436 6.45336 9.7344 6.49475 9.63447C6.53615 9.53454 6.60624 9.44913 6.69617 9.38904C6.78611 9.32895 6.89184 9.29687 7 9.29687C7.14504 9.29687 7.28414 9.35449 7.3867 9.45705C7.48926 9.55961 7.54687 9.69871 7.54687 9.84375Z" fill="currentColor"/>`,
  },
  // Figma asset c27e65e93e6f77762e374e2d15a2ceb0a3f1051a.svg — weekly-review header eyebrow icon.
  trending: {
    viewBox: "0 0 13 13",
    content: `<path d="M9.23812 7.76953C9.13652 8.33727 8.86343 8.86026 8.45559 9.26809C8.04776 9.67593 7.52477 9.94902 6.95703 10.0506C6.94022 10.0532 6.92325 10.0545 6.90625 10.0547C6.82964 10.055 6.75573 10.0264 6.69924 9.97468C6.64275 9.92294 6.60783 9.85181 6.60142 9.77547C6.59502 9.69914 6.61761 9.62319 6.66469 9.56275C6.71177 9.50232 6.77988 9.46184 6.85547 9.44938C7.73805 9.30109 8.48707 8.55156 8.63688 7.66797C8.65034 7.58824 8.69493 7.51712 8.76083 7.47027C8.79347 7.44707 8.83035 7.43052 8.86937 7.42158C8.9084 7.41263 8.9488 7.41146 8.98828 7.41813C9.02776 7.42479 9.06554 7.43917 9.09946 7.46044C9.13338 7.48171 9.16278 7.50945 9.18598 7.54208C9.20918 7.57472 9.22573 7.6116 9.23467 7.65062C9.24362 7.68965 9.24479 7.73005 9.23812 7.76953ZM10.8672 7.3125C10.8672 8.47075 10.4071 9.58156 9.58807 10.4006C8.76906 11.2196 7.65825 11.6797 6.5 11.6797C5.34175 11.6797 4.23094 11.2196 3.41193 10.4006C2.59293 9.58156 2.13281 8.47075 2.13281 7.3125C2.13281 5.91754 2.68379 4.48855 3.77051 3.06516C3.7966 3.03049 3.8298 3.0018 3.86788 2.981C3.90596 2.9602 3.94804 2.94778 3.99131 2.94456C4.03458 2.94134 4.07804 2.94739 4.11878 2.96232C4.15952 2.97725 4.1966 3.00071 4.22754 3.03113L5.56512 4.3291L6.73766 1.11414C6.75439 1.06826 6.7819 1.02708 6.81788 0.994062C6.85386 0.961043 6.89725 0.937155 6.94439 0.924411C6.99153 0.911668 7.04104 0.910442 7.08876 0.920837C7.13647 0.931232 7.18099 0.952943 7.21855 0.984141C8.31391 1.89566 10.8672 4.33672 10.8672 7.3125ZM10.2578 7.3125C10.2578 4.85469 8.29512 2.75031 7.1566 1.73672L5.97391 4.97961C5.95651 5.0274 5.92742 5.07008 5.8893 5.10375C5.85117 5.13742 5.80523 5.16102 5.75565 5.17237C5.70607 5.18373 5.65444 5.1825 5.60546 5.16879C5.55648 5.15508 5.51171 5.12932 5.47523 5.09387L4.05336 3.7116C3.18246 4.93238 2.74219 6.14453 2.74219 7.3125C2.74219 8.30913 3.1381 9.26495 3.84283 9.96967C4.54755 10.6744 5.50337 11.0703 6.5 11.0703C7.49663 11.0703 8.45245 10.6744 9.15717 9.96967C9.8619 9.26495 10.2578 8.30913 10.2578 7.3125Z" fill="currentColor"/>`,
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
      .email-soft-muted { color: ${light.softMutedText}; }
      .email-accent { color: ${light.accent}; }
      .email-link { color: ${light.linkGreen}; }
      /* color too, not just background: the ring's track circle picks this up via
         stroke=currentColor, same reasoning as email-border below. */
      .email-icon-tint { color: ${light.iconTint}; background: ${light.iconTint}; }
      .email-ring-track { color: ${light.ringTrack}; }
      .email-border { color: ${light.border}; border-color: ${light.border}; background: ${light.border}; }
      .email-input { background: ${light.inputBg}; border-color: ${light.border}; }
      .email-cta-panel-bg { background: ${light.ctaPanelBg}; }
      .email-cta-panel-text { color: ${light.ctaPanelText}; }
      @media (prefers-color-scheme: dark) {
        .email-bg { background: ${dark.pageBg} !important; }
        .email-card { background: ${dark.cardBg} !important; border-color: ${dark.cardBorder} !important; }
        .email-heading { color: ${dark.headingText} !important; }
        .email-body { color: ${dark.bodyText} !important; }
        .email-muted { color: ${dark.mutedText} !important; }
        .email-soft-muted { color: ${dark.softMutedText} !important; }
        .email-accent { color: ${dark.accent} !important; }
        .email-link { color: ${dark.linkGreen} !important; }
        .email-icon-tint { color: ${dark.iconTint} !important; background: ${dark.iconTint} !important; }
        .email-ring-track { color: ${dark.ringTrack} !important; }
        .email-border { color: ${dark.border} !important; border-color: ${dark.border} !important; background: ${dark.border} !important; }
        .email-input { background: ${dark.inputBg} !important; border-color: ${dark.border} !important; }
        .email-cta-panel-bg { background: ${dark.ctaPanelBg} !important; }
        .email-cta-panel-text { color: ${dark.ctaPanelText} !important; }
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
 * left-aligned with the eyebrow badge (optionally icon-led) on the right when
 * one is passed (weekly-review, recap) — sentence case in `linkGreen`, not the
 * uppercase/`accent` styling originally guessed before the weekly-review frame
 * (269:134) was pulled.
 */
export function emailHeader(opts?: { eyebrow?: string; eyebrowIcon?: "trending" }): string {
  const brand = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;">${LOGOMARK_SVG}</td>
      <td class="email-heading" style="vertical-align:middle;padding-left:8px;font-size:16px;font-weight:700;letter-spacing:0.2px;">THRIVO</td>
    </tr></table>`;

  if (!opts?.eyebrow) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">${brand}</td></tr></table>`;
  }

  const iconHtml = opts.eyebrowIcon
    ? `<svg width="13" height="13" viewBox="${ICONS[opts.eyebrowIcon].viewBox}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;margin-right:4px;">${ICONS[opts.eyebrowIcon].content}</svg>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="left">${brand}</td>
      <td align="right" style="font-size:12px;font-weight:600;color:${emailBrand.brightGreen};">${iconHtml}${escapeHtml(
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

/**
 * Bold heading + optional body paragraph, centered — the exact pair OTP and
 * magic-link each hand-wrote with only their top margins differing. Any new
 * "explain what this email is about" template reaches for this instead of
 * re-typing the h1/p styles a third time.
 */
export function emailHeroText(opts: {
  heading: string;
  paragraph?: string;
  headingMarginTop?: number;
  paragraphMarginTop?: number;
}): string {
  const heading = `<h1 class="email-heading" style="margin:${opts.headingMarginTop ?? 20}px 0 0;font-size:20px;font-weight:700;letter-spacing:-0.3px;">${escapeHtml(opts.heading)}</h1>`;
  const paragraph = opts.paragraph
    ? `<p class="email-body" style="margin:${opts.paragraphMarginTop ?? 10}px 0 0;font-size:14px;line-height:1.5;">${escapeHtml(opts.paragraph)}</p>`
    : "";
  return heading + paragraph;
}

/**
 * One icon + text row, for the small bullet lists under a CTA. Full-strength
 * `email-body` by default (OTP/magic-link's InfoRows — important instructional
 * text). Pass `muted` for de-emphasized notes (weekly-review's InfoRows,
 * frame 269:134, confirmed at 50%-opacity heading color for both text and icon).
 */
export function emailIconRow(opts: {
  icon: "clock" | "check" | "check-circle" | "shield" | "warning";
  text: string;
  muted?: boolean;
}): string {
  const icon = ICONS[opts.icon];
  const textClass = opts.muted ? "email-soft-muted" : "email-body";
  const color = opts.muted ? emailTokens.light.softMutedText : emailTokens.light.bodyText;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="${textClass}" width="20" valign="top" style="padding:16px 10px 16px 0;color:${color};">
        <svg width="20" height="20" viewBox="${icon.viewBox}" xmlns="http://www.w3.org/2000/svg">${icon.content}</svg>
      </td>
      <td class="${textClass}" style="font-size:14px;line-height:1.4;padding:16px 0;color:${color};">${escapeHtml(opts.text)}</td>
    </tr></table>`;
}

/**
 * A list of `emailIconRow`s with dividers auto-interleaved between them —
 * every template so far (OTP, magic-link, weekly-review) hand-interleaved
 * `emailDivider()` calls itself, one easy-to-forget divider away from a
 * missing separator. Wrapped in the standard row-list padding.
 */
export function emailRowList(
  rows: Array<{
    icon: "clock" | "check" | "check-circle" | "shield" | "warning";
    text: string;
    muted?: boolean;
  }>
): string {
  const items = rows.map((row) => emailIconRow(row));
  return `<div style="padding:4px 24px 8px;">${items.join(emailDivider())}</div>`;
}

/**
 * Circular progress ring with the percent + up to two caption lines rendered
 * as SVG `<text>` inside the same element — not an HTML overlay on top of the
 * SVG, since absolute positioning is unreliable across email clients. Used by
 * the weekly-review email's "100% — you logged 7 of 7 days" hero.
 */
export function emailProgressRing(opts: {
  percent: number;
  line1?: string;
  line2?: string;
}): string {
  const size = 172;
  const strokeWidth = 11;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, opts.percent));
  const dashoffset = circumference * (1 - clamped / 100);

  const light = emailTokens.light;
  const line1 = opts.line1
    ? `<text class="email-soft-muted" x="${center}" y="${center + 20}" text-anchor="middle" font-size="12" font-family="${emailFonts.body}" fill="currentColor" style="color:${light.softMutedText};">${escapeHtml(opts.line1)}</text>`
    : "";
  const line2 = opts.line2
    ? `<text class="email-heading" x="${center}" y="${center + 38}" text-anchor="middle" font-size="13" font-weight="700" font-family="${emailFonts.body}" fill="currentColor" style="color:${light.headingText};">${escapeHtml(opts.line2)}</text>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 4px;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <circle class="email-ring-track" cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" style="color:${light.ringTrack};"/>
        <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${emailBrand.brightGreen}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${dashoffset}" transform="rotate(-90 ${center} ${center})"/>
        <text class="email-heading" x="${center}" y="${center - 6}" text-anchor="middle" font-size="34" font-weight="700" font-family="${emailFonts.body}" fill="currentColor" style="color:${light.headingText};">${escapeHtml(`${Math.round(clamped)}%`)}</text>
        ${line1}
        ${line2}
      </svg>
    </td></tr></table>`;
}

/**
 * Full-width green CTA button (Figma "Button", 269:25/269:165) — 50px tall,
 * rounded 12px, optional leading + trailing icons (weekly-review pairs a fork
 * with a trailing arrow). Uses the fixed brand green, not the light/dark
 * `accent` token — confirmed by the dark magic-link frame (277:414) that this
 * button doesn't switch shade the way the icon badge and links do.
 */
export function emailButton(opts: {
  label: string;
  url: string;
  icon?: "link" | "fork";
  trailingIcon?: "arrow-right";
}): string {
  const icon = (
    name: "link" | "fork" | "arrow-right" | undefined,
    margin: "margin-right" | "margin-left"
  ) =>
    name
      ? `<svg width="16" height="16" viewBox="${ICONS[name].viewBox}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;${margin}:9px;">${ICONS[name].content}</svg>`
      : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${emailBrand.green};border-radius:12px;text-align:center;">
      <a href="${escapeHtml(
        opts.url
      )}" style="display:block;padding:15px 24px;color:${emailTokens.light.accentText};font-size:16px;font-weight:600;text-decoration:none;line-height:20px;">${icon(opts.icon, "margin-right")}${escapeHtml(
        opts.label
      )}${icon(opts.trailingIcon, "margin-left")}</a>
    </td></tr></table>`;
}

/** Full-bleed 1px rule (Figma "Div"/"Container" separators). Inset it by placing inside a padded cell. */
export function emailDivider(): string {
  return `<div class="email-border" style="height:1px;line-height:1px;font-size:1px;background:${emailTokens.light.border};">&nbsp;</div>`;
}

/**
 * The rounded, bordered card treatment placed below the main card (Figma
 * "Card:margin" 269:53) — a thin wrapper, no inner padding of its own, so any
 * content (a paragraph, a row list, a stat panel) supplies its own. Originally
 * hand-written twice: magic-link's fallback-link card and weekly-review's
 * info-row card. Any future "extra card below the main one" reaches for this
 * instead of re-typing the bg/border/radius/margin trio a third time.
 */
export function emailSecondaryCard(innerHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-card" style="background:${emailTokens.light.cardBg};border:1px solid ${emailTokens.light.cardBorder};border-radius:16px;margin-top:12px;">
      <tr><td>${innerHtml}</td></tr>
    </table>`;
}

/**
 * "Having trouble" fallback link, styled in `linkGreen` — confirmed as its own
 * token (not `accent`) now that the weekly-review frame independently shows
 * the same #27ae60 in light mode. See tokens.ts.
 */
export function emailFallbackLinkCard(opts: { url: string }): string {
  return emailSecondaryCard(
    `<p class="email-body" style="margin:0;padding:16px 20px;font-size:12px;line-height:1.5;word-break:break-all;">Having trouble? Copy and paste this link into your browser: <span class="email-link" style="font-weight:600;color:${emailTokens.light.linkGreen};">${escapeHtml(
      opts.url
    )}</span></p>`
  );
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
