

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole, Employee } from '../types';
import { MOCK_EMPLOYEES } from '../constants';

interface AuthContextType {
  user: User;
  setUser: (user: User) => void;
  loginAs: (role: UserRole) => void;
  isRole: (role: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Mock Users for simulation
const MOCK_USERS: Record<UserRole, User> = {
  pm: {
    id: 'u1',
    name: 'Nazar Kulyk',
    role: 'pm',
    avatar: 'https://ui-avatars.com/api/?name=Nazar+Kulyk&background=0D8ABC&color=fff',
    employeeId: 'e1'
  },
  employee: {
    id: 'u2',
    name: 'Max Berreichsleiter',
    role: 'employee',
    avatar: 'https://ui-avatars.com/api/?name=Max+Berreichsleiter&background=E8F5E9&color=2E7D32',
    employeeId: 'e2'
  },
  bl: {
    id: 'u3',
    name: 'Division Lead',
    role: 'bl',
    avatar: 'https://ui-avatars.com/api/?name=Division+Lead&background=333&color=fff'
  },
  sales: {
      id: 'u4',
      name: 'Sarah Sales',
      role: 'sales',
      avatar: 'https://ui-avatars.com/api/?name=Sarah+Sales&background=EF6C00&color=fff'
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User>(MOCK_USERS.pm); // Default to PM

  const loginAs = (role: UserRole) => {
    setUser(MOCK_USERS[role]);
  };

  const isRole = (role: UserRole | UserRole[]) => {
    if (Array.isArray(role)) {
      return role.includes(user.role);
    }
    return user.role === role;
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loginAs, isRole }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};