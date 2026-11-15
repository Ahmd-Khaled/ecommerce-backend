import type { HAdminDocument } from '../../DB/models/admin/admin.interface';
import type { JwtPayload } from 'jsonwebtoken';
import type { HUserDocument } from '../../DB/models/user/user.interface';

declare global {
  namespace Express {
    interface Request {
      language: import('../i18n').Language;
      // These are populated after authentication and authorization succeed.
      user?: HUserDocument;
      admin?: HAdminDocument;
      decoded?: JwtPayload;
    }
  }
}
