import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { baseApi, sessionSlice } from '@/lib/api';

export const store = configureStore({
  reducer: { session: sessionSlice.reducer, [baseApi.reducerPath]: baseApi.reducer },
  middleware: (gdm) => gdm().concat(baseApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export const useAppDispatch = useDispatch.withTypes<typeof store.dispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
