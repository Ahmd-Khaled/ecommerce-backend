import { hash, compare } from 'bcrypt';

export const generateHash = async (plaintext: string, saltRounds: number = Number(process.env.SALT_ROUNDS))
  : Promise<string> => {
  return await hash(plaintext, saltRounds);
};

export const compareHash = async (plaintext: string, hashedText: string): Promise<boolean> => {
  return await compare(plaintext, hashedText);
}