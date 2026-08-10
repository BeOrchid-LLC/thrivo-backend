import type { SendEmailInput } from "../../integrations/resend";

/** Rasterized production Thrivo mark for email clients that reject inline SVG. */
export const EMAIL_CID_ATTACHMENTS: NonNullable<SendEmailInput["attachments"]> = [
  {
    filename: "thrivo-logo.png",
    content:
      "iVBORw0KGgoAAAANSUhEUgAAACwAAAAsCAYAAAAehFoBAAAACXBIWXMAAAsTAAALEwEAmpwYAAACDklEQVRYhe2YvWsUQRiHXz/OzKAmmTku5C9QFINgUDQzZwStBREbI2JlEUkhYus670JCCGrsss7mH/CrSiliwFLkCgs1nAoWNhLibIQ0ZkQTDYQT1719jcI88Ku22IeHmWaAG+04al94Ri9zVF9YrD4z1M94rC7BKi7tPupScdNZ+dxZ8cFZuZyl0heeFQ44qldtCbfYsbEDi3NJrdmWXGvhl8BQPyxT9sqNPX4hrZYrmv4Uvg8dWL9QlixO7qIRTVe2OC3PQ1c02M2Mnm9X9uxEn3eEspmVH+cT0fX9cjCsX21HthYP+Dd3aqR1Mysv/7jMANHebRzV06LC127tppad9QlU1oQBYHt0pIejnisi3JjqJZQVr930jhq0YufowSpH/fhPZPeNHiKTdVY8WrCdsqXs2vGAzdzoMxzV2zzCJ8f3ly+aivfOiov+LmyB3CT9lY5Yn2CobjNUM8zoBkfdXL+hiT73YqrX59m7pOdTZmVz/ZyVjczKGWfFZJZWj/sItgIVPNYjuY9QrEfIRIIwhsLFCGeYmlCYmlCYmlCYmlCYmlCYmlCYmlCYmlCYmlCYmlCYmv+vsNHDuYWNHt5oX+Cmfjq/sDq10b4rb8pGLeWQXeqMDv/mrfcvwVGN5yg8Bv8MSX+FGf3gV7LMqHsQDdK9+RbCwyaG+hw3apajylb3hF0fGPr2razffAWsD2PHkGYrygAAAABJRU5ErkJggg==",
    contentType: "image/png",
    contentId: "thrivo-logo",
  },
];
