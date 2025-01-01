import { testCodeAction } from "./codeActionTestBase";

describe("inline function code action", () => {
  it("should inline function and compute parameters", async () => {
    const source = `
--@ Test.elm
module Test exposing (..)

val2 = 
    0

foo val str =
    case val of
        Just { field1, field2, field3 } ->
            newFunction field1 val field2
            --^

        Nothing ->
            str + val2


newFunction : Maybe { a | prop1 : number, prop2 : number } -> Maybe { b | field1 : Maybe { a | prop1 : number, prop2 : number }, field2 : unknown, field3 : c } -> unknown -> unknown
newFunction f1 val f2 =
    case f1 of
        Just { prop1, prop2 } ->
            prop1 + prop2 + val + f2

        Nothing ->
            f2 + val2
`;

    const expectedSource = `
--@ Test.elm
module Test exposing (..)

val2 = 
    0

foo val str =
    case val of
        Just { field1, field2, field3 } ->
            case field1 of
                Just { prop1, prop2 } ->
                    prop1 + prop2 + val + field2

                Nothing ->
                    field2 + val2

        Nothing ->
            str + val2
`;

    await testCodeAction(
      source,
      [{ title: "Inline function and remove definition" }],
      expectedSource,
    );
  });
});
