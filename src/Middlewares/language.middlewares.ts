import type { RequestHandler } from 'express';
import { resolveLanguage } from '../Utils/i18n';

export const languageMiddleware: RequestHandler = (req, res, next) => {
  req.language = resolveLanguage(req.get('Accept-Language'));
  res.setHeader('Content-Language', req.language);
  res.vary('Accept-Language');
  next();
};
