import type { JwtPayload } from "jsonwebtoken";
import type { HUserDocument } from "../../DB/models/user/user.interface";

declare global {
  namespace Express {
    interface Request {
      // These are populated after authentication and authorization succeed.
      user?: HUserDocument;
      decoded?: JwtPayload;
    }
  }
}
